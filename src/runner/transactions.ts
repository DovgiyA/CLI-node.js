import type { Umzug } from 'umzug';

import type { Sql } from '../database.js';
import type { TransactionMode } from '../config/types.js';
import type { LoadedMigration, MigrationContext } from '../migrations/types.js';

export type TransactionScope = {
  /** Rolls back a per-Migration transaction left open by a failure. */
  rollbackIfNeeded: () => Promise<boolean>;
};

const begin = (sql: Sql): Promise<unknown> => sql.query('BEGIN');
const commit = (sql: Sql): Promise<unknown> => sql.query('COMMIT');
const rollback = (sql: Sql): Promise<unknown> => sql.query('ROLLBACK');

/** Whether this Migration should run inside a transaction for the given mode. */
export const isTransactional = (
  mode: TransactionMode,
  migration: Pick<LoadedMigration, 'transaction'>,
): boolean => {
  if (mode === 'none') {
    return false;
  }

  if (mode === 'each' && migration.transaction === false) {
    return false;
  }

  return true;
};

/** Wraps the whole Run in one transaction. */
export const withAllTransaction = async <T>(sql: Sql, run: () => Promise<T>): Promise<T> => {
  await begin(sql);

  try {
    const result = await run();
    await commit(sql);
    return result;
  } catch (error) {
    await rollback(sql);
    throw error;
  }
};

type Direction = 'up' | 'down';

/**
 * Opens and closes a transaction around each Migration. umzug logs to the
 * Journal between up/down and migrated/reverted, so COMMIT on the end event
 * keeps schema and Journal aligned.
 */
export const bindEachTransactions = (
  umzug: Umzug<MigrationContext>,
  sql: Sql,
  migrations: readonly LoadedMigration[],
  mode: TransactionMode,
  direction: Direction,
): TransactionScope => {
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));
  let open = false;

  const startEvent = direction === 'up' ? 'migrating' : 'reverting';
  const endEvent = direction === 'up' ? 'migrated' : 'reverted';

  umzug.on(startEvent, async ({ name }) => {
    const migration = byName.get(name);

    if (migration === undefined || !isTransactional(mode, migration)) {
      return;
    }

    await begin(sql);
    open = true;
  });

  umzug.on(endEvent, async () => {
    if (!open) {
      return;
    }

    await commit(sql);
    open = false;
  });

  return {
    rollbackIfNeeded: async () => {
      if (!open) {
        return false;
      }

      await rollback(sql);
      open = false;
      return true;
    },
  };
};
