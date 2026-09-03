import type { Logger } from 'pino';
import { Umzug, type MigrateDownOptions, type MigrateUpOptions } from 'umzug';

import type { TransactionMode } from '../config/types.js';
import type { Sql } from '../database.js';
import { MigrationFailedError } from '../errors.js';
import type { Journal } from '../journal/journal.js';
import type { LoadedMigration, MigrationContext } from '../migrations/types.js';
import {
  migrationsToRevertForDownTo,
  upToAlreadyReached,
} from '../selection/resolve.js';
import type { DownSelection, UpSelection } from '../selection/types.js';
import {
  bindEachTransactions,
  withAllTransaction,
  type TransactionScope,
} from './transactions.js';

export type RunnerOptions = {
  migrations: readonly LoadedMigration[];
  journal: Journal;
  sql: Sql;
  logger: Logger;
  transaction: TransactionMode;
};

type RunDirection = 'up' | 'down';

/**
 * umzug's storage contract carries a shared context, not a per-Migration one,
 * so the Checksum of the file being applied is looked up by name here. This is
 * the only place that knows umzug's vocabulary; the Journal stays in ours.
 */
const asUmzugStorage = (journal: Journal, migrations: readonly LoadedMigration[]) => {
  const checksums = new Map(migrations.map((migration) => [migration.name, migration.checksum]));

  return {
    logMigration: async ({ name }: { name: string }) => {
      const checksum = checksums.get(name);

      if (checksum === undefined) {
        throw new Error(`Нет Checksum для миграции ${name}`);
      }

      await journal.record({ name, checksum });
    },
    unlogMigration: async ({ name }: { name: string }) => {
      await journal.forget({ name });
    },
    executed: () => journal.executed(),
  };
};

const buildUmzug = (options: RunnerOptions) => {
  const { migrations, journal, sql, logger } = options;
  const context: MigrationContext = { sql, logger };

  return new Umzug({
    migrations: migrations.map((migration) => {
      const { down } = migration;

      return {
        name: migration.name,
        up: async () => migration.up(context),
        ...(down === undefined ? {} : { down: async () => down(context) }),
      };
    }),
    storage: asUmzugStorage(journal, migrations),
    context,
    logger: undefined,
  });
};

const trackRun = async (
  umzug: Umzug<MigrationContext>,
  direction: RunDirection,
  transaction: TransactionScope | undefined,
  transactionMode: TransactionMode,
  run: () => Promise<unknown>,
): Promise<string[]> => {
  const names: string[] = [];
  let attempting: string | undefined;

  const startEvent = direction === 'up' ? 'migrating' : 'reverting';
  const doneEvent = direction === 'up' ? 'migrated' : 'reverted';

  umzug.on(startEvent, ({ name }) => void (attempting = name));
  umzug.on(doneEvent, ({ name }) => void names.push(name));

  try {
    await run();
  } catch (cause) {
    const rolledBack =
      transactionMode === 'all'
        ? true
        : transactionMode === 'each'
          ? ((await transaction?.rollbackIfNeeded()) ?? false)
          : false;

    throw new MigrationFailedError(attempting ?? 'неизвестная миграция', names, {
      cause,
      direction,
      transaction: transactionMode,
      rolledBack,
    });
  }

  return names;
};

const upOptionsFor = (
  selection: UpSelection,
  knownNames: readonly string[],
  executedNames: readonly string[],
  pendingNames: readonly string[],
): MigrateUpOptions | null => {
  if (selection.kind === 'all') {
    return {};
  }

  if (selection.kind === 'step') {
    return { step: selection.step };
  }

  if (upToAlreadyReached(knownNames, executedNames, pendingNames, selection.name)) {
    return null;
  }

  return { to: selection.name };
};

const downOptionsFor = async (
  selection: DownSelection,
  journal: Journal,
): Promise<MigrateDownOptions> => {
  if (selection.kind === 'all') {
    return { to: 0 };
  }

  if (selection.kind === 'step') {
    return { step: selection.step };
  }

  const executed = await journal.executed();
  const migrations = migrationsToRevertForDownTo(executed, selection.name);

  if (migrations.length === 0) {
    return { migrations: [] };
  }

  return { migrations };
};

const executeRun = (
  options: RunnerOptions,
  umzug: Umzug<MigrationContext>,
  direction: RunDirection,
  runUmzug: () => Promise<unknown>,
): Promise<string[]> => {
  const run = () =>
    trackRun(
      umzug,
      direction,
      options.transaction === 'each'
        ? bindEachTransactions(umzug, options.sql, options.migrations, options.transaction, direction)
        : undefined,
      options.transaction,
      runUmzug,
    );

  if (options.transaction === 'all') {
    return withAllTransaction(options.sql, run);
  }

  return run();
};

/** Applies Pending Migration according to the selection and reports what ran. */
export const applyMigrations = async (
  options: RunnerOptions,
  selection: UpSelection = { kind: 'all' },
): Promise<string[]> => {
  const umzug = buildUmzug(options);
  const knownNames = options.migrations.map((migration) => migration.name);
  const executedNames = await options.journal.executed();
  const pendingNames = (await umzug.pending()).map((migration) => migration.name);
  const umzugOptions = upOptionsFor(selection, knownNames, executedNames, pendingNames);

  if (umzugOptions === null) {
    return [];
  }

  return executeRun(options, umzug, 'up', () => umzug.up(umzugOptions));
};

/** Reverts Executed Migration according to the selection and reports what ran. */
export const revertMigrations = async (
  options: RunnerOptions,
  selection: DownSelection,
): Promise<{ reverted: string[]; idle?: 'nothing-executed' | 'already-at-target' }> => {
  const executed = await options.journal.executed();

  if (executed.length === 0 && selection.kind !== 'to') {
    return { reverted: [], idle: 'nothing-executed' };
  }

  const umzug = buildUmzug(options);
  const umzugOptions = await downOptionsFor(selection, options.journal);

  if ('migrations' in umzugOptions && umzugOptions.migrations.length === 0) {
    return { reverted: [], idle: 'already-at-target' };
  }

  const reverted = await executeRun(options, umzug, 'down', () => umzug.down(umzugOptions));

  return { reverted };
};
