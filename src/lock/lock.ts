import { Client } from 'pg';

import { LockBusyError, type LockHolder } from '../errors.js';
import { asDatabaseAccessError } from '../database.js';

/** Stable namespace for advisory-lock keys — one Lock per database URL. */
export const lockNamespace = 'migrate:@alex/migrate';

const keysSql = `hashtext($1), hashtext($2)`;

const readHolder = async (client: Client, databaseUrl: string): Promise<LockHolder | undefined> => {
  const { rows } = await client.query<{
    pid: number;
    label: string;
    since: Date;
  }>(
    `select a.pid,
            coalesce(nullif(a.application_name, ''), 'pid ' || a.pid::text) as label,
            a.backend_start as since
     from pg_locks l
     join pg_stat_activity a on l.pid = a.pid
     where l.locktype = 'advisory'
       and l.classid = hashtext($1)
       and l.objid = hashtext($2)
       and l.granted
     limit 1`,
    [lockNamespace, databaseUrl],
  );

  return rows[0];
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const tryAcquire = async (client: Client, databaseUrl: string): Promise<boolean> => {
  const { rows } = await client.query<{ acquired: boolean }>(
    `select pg_try_advisory_lock(${keysSql}) as acquired`,
    [lockNamespace, databaseUrl],
  );

  return rows[0]?.acquired === true;
};

const release = async (client: Client, databaseUrl: string): Promise<void> => {
  await client.query(`select pg_advisory_unlock(${keysSql})`, [lockNamespace, databaseUrl]);
};

/** Who holds the Lock for this database URL, if anyone. */
export const holderOf = async (databaseUrl: string): Promise<LockHolder | undefined> => {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
  } catch (cause) {
    throw asDatabaseAccessError(cause);
  }

  try {
    return await readHolder(client, databaseUrl);
  } finally {
    await client.end();
  }
};

const holderAfterBusy = async (client: Client, databaseUrl: string): Promise<LockHolder> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const holder = await readHolder(client, databaseUrl);

    if (holder !== undefined) {
      return holder;
    }

    await wait(20);
  }

  return { pid: 0, label: 'неизвестный процесс' };
};

/**
 * Runs work while holding a session advisory lock on a dedicated connection.
 * The lock is non-blocking: a busy Lock fails immediately with LockBusyError.
 */
export const withAdvisoryLock = async <T>(databaseUrl: string, run: () => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
  } catch (cause) {
    throw asDatabaseAccessError(cause);
  }

  try {
    if (!(await tryAcquire(client, databaseUrl))) {
      throw new LockBusyError(await holderAfterBusy(client, databaseUrl));
    }

    return await run();
  } finally {
    try {
      await release(client, databaseUrl);
    } catch {
      // The connection may already be broken; ending it still drops the session lock.
    }

    await client.end();
  }
};
