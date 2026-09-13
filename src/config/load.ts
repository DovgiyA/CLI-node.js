import { isAbsolute, resolve } from 'node:path';

import { ConfigInvalidError, ConfigLoadError, type ConfigField } from '../errors.js';
import { loggerKinds, type LoggerKind } from '../logger.js';
import { importTypeScript } from '../ts-runtime.js';
import { locateConfig } from './locate.js';
import {
  configDefaults,
  defaultEnv,
  storageKinds,
  transactionModes,
  type Config,
  type ConfigInput,
  type ConfigModule,
  type StorageKind,
  type TransactionMode,
} from './types.js';

export type LoadConfigOptions = {
  cwd: string;
  /** Spelled `| undefined` on purpose: callers pass through absent flags as-is. */
  explicitPath?: string | undefined;
  envFlag?: string | undefined;
  nodeEnv?: string | undefined;
};

const importConfigModule = async (path: string): Promise<ConfigModule> => {
  let module: { default?: unknown };
  try {
    module = await importTypeScript(path);
  } catch (cause) {
    throw new ConfigLoadError(
      path,
      cause instanceof Error ? cause.message : String(cause),
      'Проверьте, что файл корректен и его импорты разрешаются.',
      { cause },
    );
  }

  const exported = module.default;

  if (exported === undefined) {
    throw new ConfigLoadError(
      path,
      'нет экспорта по умолчанию',
      'Экспортируйте конфиг через `export default defineConfig({ ... })`.',
    );
  }

  if (typeof exported !== 'object' && typeof exported !== 'function') {
    throw new ConfigLoadError(
      path,
      `экспорт по умолчанию имеет тип ${typeof exported}`,
      'Экспортируйте объект конфига или функцию, принимающую окружение.',
    );
  }

  return exported as ConfigModule;
};

const requireDatabase = (input: ConfigInput): Config['database'] => {
  const { database } = input;

  if (typeof database === 'function') {
    return database;
  }

  if (typeof database === 'string' && database.trim() !== '') {
    return database;
  }

  throw new ConfigInvalidError(
    'database',
    'должно быть непустой строкой подключения или фабрикой клиента',
    'Укажите строку вида postgres://user:password@host:port/database, например из переменной окружения.',
  );
};

const requireOneOf = <T extends string>(
  field: ConfigField,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => {
  if (value === undefined) {
    return fallback;
  }

  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }

  throw new ConfigInvalidError(
    field,
    `имеет неизвестное значение ${value}`,
    `Допустимые значения: ${allowed.join(', ')}.`,
  );
};

const requireNonEmptyString = (field: ConfigField, value: unknown, fallback: string): string => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }

  throw new ConfigInvalidError(field, 'должно быть непустой строкой', `Уберите поле ${field}, чтобы использовать умолчание.`);
};

/**
 * Finds, loads and validates the Config. Nothing here touches the network:
 * a broken Config must be reported before the first connection attempt.
 */
export const loadConfig = async (options: LoadConfigOptions): Promise<Config> => {
  const { cwd, explicitPath, envFlag, nodeEnv } = options;
  const path = await locateConfig(cwd, explicitPath);
  const env = envFlag ?? nodeEnv ?? defaultEnv;

  const module = await importConfigModule(path);
  const produced = typeof module === 'function' ? module(env) : module;

  if (produced instanceof Promise) {
    throw new ConfigLoadError(
      path,
      'конфиг-функция вернула Promise',
      'Конфиг-функция обязана быть синхронной: иначе --config перестаёт быть предсказуемым. Уберите async и читайте значения из переменных окружения.',
    );
  }

  const input = produced;

  const migrationsDir = requireNonEmptyString(
    'migrationsDir',
    input.migrationsDir,
    configDefaults.migrationsDir,
  );

  const seedersDir = requireNonEmptyString('seedersDir', input.seedersDir, configDefaults.seedersDir);

  return {
    database: requireDatabase(input),
    migrationsDir: isAbsolute(migrationsDir) ? migrationsDir : resolve(cwd, migrationsDir),
    seedersDir: isAbsolute(seedersDir) ? seedersDir : resolve(cwd, seedersDir),
    pattern: requireNonEmptyString('pattern', input.pattern, configDefaults.pattern),
    storage: requireOneOf<StorageKind>('storage', input.storage, storageKinds, configDefaults.storage),
    transaction: requireOneOf<TransactionMode>(
      'transaction',
      input.transaction,
      transactionModes,
      configDefaults.transaction,
    ),
    logger: requireOneOf<LoggerKind>('logger', input.logger, loggerKinds, configDefaults.logger),
    env: requireNonEmptyString('env', input.env, env),
    path,
  };
};
