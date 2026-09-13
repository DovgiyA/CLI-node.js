import type { Logger } from 'pino';

import type { Config } from '../config/types.js';
import type { Namespace } from '../journal/journal.js';
import { loadMigration } from '../migrations/load.js';
import type { AppliedResult } from '../reporter.js';
import { driftOf, reportDrift } from '../integrity/integrity.js';
import { applyMigrations } from '../runner/runner.js';
import { requireUpToTarget } from '../selection/resolve.js';
import type { UpSelection } from '../selection/types.js';
import { filesOf, inLockedSession } from './session.js';

export type UpOptions = {
  config: Config;
  namespace: Namespace;
  logger: Logger;
  selection?: UpSelection;
  strict?: boolean;
};

/**
 * Applies Pending Migration according to the selection and reports what ran.
 * Files are found and loaded before the connection is opened.
 */
export const up = async (options: UpOptions): Promise<AppliedResult> => {
  const { config, namespace, logger, selection = { kind: 'all' }, strict = false } = options;

  const files = await filesOf({ config, namespace });

  if (selection.kind === 'to') {
    requireUpToTarget(
      files.map((file) => file.name),
      selection.name,
    );
  }

  const migrations = await Promise.all(files.map(loadMigration));

  const applied = await inLockedSession({ config, namespace }, async ({ journal, sql }) => {
    const records = await journal.records();
    reportDrift(driftOf(files, records), strict, logger);

    return applyMigrations({ migrations, journal, sql, logger, transaction: config.transaction }, selection);
  });

  return { namespace, applied };
};
