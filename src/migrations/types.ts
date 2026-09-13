import type { ClientBase } from 'pg';
import type { Logger } from 'pino';

/**
 * What a Migration is handed. `sql` is the very client the Run holds, so when
 * the Run is transactional the Migration writes inside that transaction.
 */
export type MigrationContext = {
  sql: ClientBase;
  logger: Logger;
};

export type MigrationOperation = (context: MigrationContext) => Promise<void>;

/** What a Migration file exports by default. */
export type MigrationDefinition = {
  up: MigrationOperation;
  down?: MigrationOperation;
  /**
   * Set to false for statements Postgres refuses inside a transaction, such as
   * `CREATE INDEX CONCURRENTLY`. Overrides the Config's transaction mode for
   * this Migration only.
   */
  transaction?: false;
};

/** A Migration file found on disk, before its module is imported. */
export type MigrationFile = {
  name: string;
  path: string;
  checksum: string;
};

/** A Migration ready to be run. */
export type LoadedMigration = {
  name: string;
  path: string;
  checksum: string;
  up: MigrationOperation;
  down: MigrationOperation | undefined;
  transaction: boolean;
};

export const checksumPreviewLength = 16;

/** Checksums are 64 hex chars; output shows only the leading part. */
export const previewChecksum = (checksum: string): string =>
  checksum.slice(0, checksumPreviewLength);
