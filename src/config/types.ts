import type { LoggerKind } from '../logger.js';

export type TransactionMode = 'all' | 'each' | 'none';

export const transactionModes: readonly TransactionMode[] = ['all', 'each', 'none'];

/** Only the Journal table exists so far; see ADR-0001. */
export type StorageKind = 'table';

export const storageKinds: readonly StorageKind[] = ['table'];

export type DatabaseClientFactory = () => unknown;

/** A connection string, or a factory the CLI calls to get its own client. */
export type Database = string | DatabaseClientFactory;

/** What a consumer project writes in its Config file. */
export type ConfigInput = {
  database: Database;
  migrationsDir?: string;
  seedersDir?: string;
  pattern?: string;
  storage?: StorageKind;
  transaction?: TransactionMode;
  logger?: LoggerKind;
  env?: string;
};

export type ConfigFactory = (env: string) => ConfigInput;

export type ConfigModule = ConfigInput | ConfigFactory;

/** A Config with defaults filled in and paths made absolute. */
export type Config = {
  database: Database;
  migrationsDir: string;
  seedersDir: string;
  pattern: string;
  storage: StorageKind;
  transaction: TransactionMode;
  logger: LoggerKind;
  env: string;
  path: string;
};

export const defaultEnv = 'dev';

export const configDefaults = {
  migrationsDir: 'migrations',
  seedersDir: 'seeders',
  pattern: '*.{ts,js}',
  storage: 'table',
  transaction: 'each',
  logger: 'pretty',
} as const satisfies Omit<ConfigInput, 'database' | 'env'>;
