import type { Logger } from 'pino';

import type { Config } from '../config/types.js';
import { driftOf, reportDrift } from '../integrity/integrity.js';
import type { JournalRecord, Namespace } from '../journal/journal.js';
import { compareByName } from '../migrations/discover.js';
import { previewChecksum } from '../migrations/types.js';
import type { StatusEntry, StatusResult } from '../reporter.js';
import { filesOf, inSession } from './session.js';

export type StatusOptions = {
  config: Config;
  namespace: Namespace;
  logger: Logger;
  strict?: boolean;
};

/**
 * Joins what the Journal says with what is on disk: Executed, Pending or Missing.
 */
export const status = async (options: StatusOptions): Promise<StatusResult> => {
  const { config, namespace, logger, strict = false } = options;

  const files = await filesOf({ config, namespace });

  return inSession({ config, namespace }, async ({ journal }) => {
    const records = await journal.records();
    reportDrift(driftOf(files, records), strict, logger);

    const recordsByName = new Map(records.map((record) => [record.name, record]));

    const entryOf = (record: JournalRecord): StatusEntry => ({
      name: record.name,
      state: 'executed',
      appliedAt: record.appliedAt.toISOString(),
      checksum: previewChecksum(record.checksum),
    });

    const onDisk = new Set(files.map((file) => file.name));

    const fromDisk: StatusEntry[] = files.map((file) => {
      const record = recordsByName.get(file.name);

      return record === undefined
        ? {
            name: file.name,
            state: 'pending',
            appliedAt: null,
            checksum: previewChecksum(file.checksum),
          }
        : entryOf(record);
    });

    const withoutFile: StatusEntry[] = records
      .filter((record) => !onDisk.has(record.name))
      .map((record) => ({
        name: record.name,
        state: 'missing' as const,
        appliedAt: record.appliedAt.toISOString(),
        checksum: previewChecksum(record.checksum),
      }));

    return {
      namespace,
      migrations: [...fromDisk, ...withoutFile].sort(compareByName),
    };
  });
};
