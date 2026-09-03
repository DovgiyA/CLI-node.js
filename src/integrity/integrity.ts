import type { Logger } from 'pino';

import { DriftError, MissingMigrationError } from '../errors.js';
import type { JournalRecord } from '../journal/journal.js';
import type { MigrationFile } from '../migrations/types.js';
import { migrationsToRevertForDownTo } from '../selection/resolve.js';
import type { DownSelection } from '../selection/types.js';

/** Applied Migration whose file Checksum no longer matches the Journal. */
export const driftOf = (
  files: readonly MigrationFile[],
  records: readonly JournalRecord[],
): string[] => {
  const byName = new Map(files.map((file) => [file.name, file]));

  return records
    .filter((record) => {
      const file = byName.get(record.name);

      return file !== undefined && file.checksum !== record.checksum;
    })
    .map((record) => record.name);
};

/** Executed Migration with a Journal record but no file on disk. */
export const missingOf = (
  files: readonly MigrationFile[],
  records: readonly JournalRecord[],
): string[] => {
  const onDisk = new Set(files.map((file) => file.name));

  return records.filter((record) => !onDisk.has(record.name)).map((record) => record.name);
};

export const migrationsToRevertForSelection = (
  selection: DownSelection,
  executed: readonly string[],
): string[] => {
  if (executed.length === 0) {
    return [];
  }

  if (selection.kind === 'all') {
    return [...executed].reverse();
  }

  if (selection.kind === 'step') {
    return executed.slice(-selection.step).reverse();
  }

  return migrationsToRevertForDownTo(executed, selection.name);
};

/** The Missing Migration that blocks this down selection, if any. */
export const missingBlockingDown = (
  selection: DownSelection,
  executed: readonly string[],
  missing: readonly string[],
): string | undefined => {
  if (missing.length === 0) {
    return undefined;
  }

  const missingSet = new Set(missing);

  return migrationsToRevertForSelection(selection, executed).find((name) => missingSet.has(name));
};

/** Warns about Drift or fails when `--strict` is set. */
export const reportDrift = (
  drift: readonly string[],
  strict: boolean,
  logger: Logger,
): void => {
  if (drift.length === 0) {
    return;
  }

  if (strict) {
    throw new DriftError(drift);
  }

  for (const migration of drift) {
    logger.warn(
      { kind: 'drift', migration },
      `Drift: миграция ${migration} изменилась после применения`,
    );
  }
};

export const assertDownNotBlockedByMissing = (
  selection: DownSelection,
  executed: readonly string[],
  missing: readonly string[],
): void => {
  const blocker = missingBlockingDown(selection, executed, missing);

  if (blocker !== undefined) {
    throw new MissingMigrationError(blocker);
  }
};
