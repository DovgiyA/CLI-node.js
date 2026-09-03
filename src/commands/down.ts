import type { Logger } from 'pino';

import type { Config } from '../config/types.js';
import { DownConfirmationRequiredError } from '../errors.js';
import type { Io } from '../io.js';
import type { Namespace } from '../journal/journal.js';
import { loadMigration } from '../migrations/load.js';
import type { RevertedResult } from '../reporter.js';
import { requireDownConfirmation } from '../down/confirmation.js';
import {
  assertDownNotBlockedByMissing,
  driftOf,
  missingOf,
  migrationsToRevertForSelection,
  reportDrift,
} from '../integrity/integrity.js';
import { revertMigrations } from '../runner/runner.js';
import type { DownSelection } from '../selection/types.js';
import { filesOf, inLockedSession } from './session.js';

export type DownOptions = {
  config: Config;
  namespace: Namespace;
  logger: Logger;
  selection: DownSelection;
  strict?: boolean;
  force?: boolean;
  io: Io;
};

/** Reverts Executed Migration according to the selection and reports what ran. */
export const down = async (options: DownOptions): Promise<RevertedResult> => {
  const { config, namespace, logger, selection, strict = false, force = false, io } = options;

  if (config.env !== 'dev' && !force && !io.isTty) {
    throw new DownConfirmationRequiredError();
  }

  const files = await filesOf({ config, namespace });
  const migrations = await Promise.all(files.map(loadMigration));

  const outcome = await inLockedSession({ config, namespace }, async ({ journal, sql }) => {
    const records = await journal.records();
    const executed = await journal.executed();

    reportDrift(driftOf(files, records), strict, logger);
    assertDownNotBlockedByMissing(selection, executed, missingOf(files, records));

    const toRevert = migrationsToRevertForSelection(selection, executed);
    await requireDownConfirmation(io, config, force, toRevert[0]);

    return revertMigrations({ migrations, journal, sql, logger, transaction: config.transaction }, selection);
  });

  return { namespace, ...outcome };
};
