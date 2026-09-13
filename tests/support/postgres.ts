import { randomBytes } from 'node:crypto';

import { Client } from 'pg';

export const baseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://migrate:migrate@localhost:54329/migrate';

export type TestSchema = {
  schema: string;
  /** A connection string whose search_path points at this schema only. */
  url: string;
  query: <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<T[]>;
  drop: () => Promise<void>;
};

const withClient = async <T>(url: string, use: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

/**
 * Each test gets its own schema, so the Journal of one test is invisible to the
 * next even though every test talks to the same database.
 */
export const createTestSchema = async (): Promise<TestSchema> => {
  const schema = `t_${randomBytes(6).toString('hex')}`;

  await withClient(baseUrl, (client) => client.query(`create schema "${schema}"`));

  const url = `${baseUrl}?options=-c%20search_path%3D${schema}`;

  return {
    schema,
    url,
    query: async <T extends Record<string, unknown>>(sql: string, values: unknown[] = []) =>
      withClient(url, async (client) => (await client.query<T>(sql, values)).rows),
    drop: async () => {
      await withClient(baseUrl, (client) => client.query(`drop schema "${schema}" cascade`));
    },
  };
};

/**
 * Hands out schemas and drops them after each test, so a test file only says
 * `const schema = await freshSchema()` and forgets about cleanup.
 */
export const useTestSchemas = (
  afterEachHook: (cleanup: () => Promise<void>) => void,
): (() => Promise<TestSchema>) => {
  const created: TestSchema[] = [];

  afterEachHook(async () => {
    await Promise.all(created.splice(0).map((schema) => schema.drop()));
  });

  return async () => {
    const schema = await createTestSchema();
    created.push(schema);
    return schema;
  };
};

/**
 * Integration tests are worthless if they quietly vanish. With no database
 * reachable this throws at collection time, unless skipping was asked for
 * explicitly — a green run must never mean "nothing was checked".
 */
export const isPostgresReachable = async (): Promise<boolean> => {
  try {
    await withClient(baseUrl, async () => undefined);
    return true;
  } catch (cause) {
    if (process.env.MIGRATE_SKIP_DB_TESTS === '1') {
      return false;
    }

    throw new Error(
      `Postgres недоступен по ${baseUrl}. Поднимите его через \`npm run db:up\`, ` +
        'задайте TEST_DATABASE_URL или пропустите эти тесты явно через MIGRATE_SKIP_DB_TESTS=1.',
      { cause },
    );
  }
};
