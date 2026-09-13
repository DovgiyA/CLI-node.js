import { Client, type ClientBase } from 'pg';

import { DatabaseAccessError } from './errors.js';

/** Anything a Migration or the Journal can send statements through. */
export type Sql = ClientBase;

export const asDatabaseAccessError = (cause: unknown): DatabaseAccessError => {
  const message = cause instanceof Error ? cause.message : String(cause);

  return new DatabaseAccessError(
    `Не удалось обратиться к базе: ${message}`,
    'Проверьте строку подключения в конфиге и доступность базы.',
    { cause },
  );
};

/**
 * One Run, one connection. The Journal and the Migration share it, so once
 * transactions arrive the record of an application and the application itself
 * are the same transaction — see ADR-0001.
 */
export const withConnection = async <T>(url: string, use: (sql: Sql) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: url });

  try {
    await client.connect();
  } catch (cause) {
    throw asDatabaseAccessError(cause);
  }

  try {
    return await use(client);
  } finally {
    await client.end();
  }
};
