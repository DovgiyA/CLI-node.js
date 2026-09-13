import { ConfigInvalidError } from '../errors.js';
import type { Config } from './types.js';

/**
 * Every command that talks to the database needs a connection string, so the
 * one capability the Config can express but the CLI cannot yet honour — a
 * client factory — is refused in a single place.
 */
export const connectionStringOf = (config: Config): string => {
  if (typeof config.database === 'string') {
    return config.database;
  }

  throw new ConfigInvalidError(
    'database',
    'задано фабрикой клиента, а её поддержка ещё не реализована',
    'Укажите строку подключения вида postgres://user:password@host:port/database.',
  );
};
