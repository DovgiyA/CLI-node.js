import { afterEach, describe, expect, it } from 'vitest';

import { withConnection } from '../src/database.js';
import { openJournal, type Journal, type Namespace } from '../src/journal/journal.js';
import { isPostgresReachable, useTestSchemas } from './support/postgres.js';

// Evaluated at collection time: `describe.skipIf` runs before any hook does.
const reachable = await isPostgresReachable();

const freshSchema = useTestSchemas(afterEach);

/**
 * The Journal lives on a connection the caller owns, so every test opens one
 * and hands it back — the same arrangement a Run uses.
 */
const withJournal = async <T>(
  url: string,
  namespace: Namespace,
  use: (journal: Journal) => Promise<T>,
): Promise<T> =>
  withConnection(url, async (sql) => use(await openJournal({ sql, namespace })));

describe.skipIf(!reachable)('the Journal table', () => {
  it('is created on first use', async () => {
    const { url, query } = await freshSchema();

    await withJournal(url, 'migrations', async () => undefined);

    const columns = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = current_schema() and table_name = '__migrations'
       order by ordinal_position`,
    );

    expect(columns.map((row) => row.column_name)).toEqual([
      'namespace',
      'name',
      'applied_at',
      'checksum',
    ]);
  });

  it('is reused instead of failing when it already exists', async () => {
    const { url } = await freshSchema();

    await withJournal(url, 'migrations', async () => undefined);

    await expect(
      withJournal(url, 'migrations', (journal) => journal.executed()),
    ).resolves.toEqual([]);
  });

  it('keys records by Namespace and name together', async () => {
    const { url, query } = await freshSchema();

    await withJournal(url, 'migrations', async () => undefined);

    const keys = await query<{ column_name: string }>(
      `select kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
        and kcu.constraint_schema = tc.constraint_schema
       where tc.table_schema = current_schema()
         and tc.table_name = '__migrations'
         and tc.constraint_type = 'PRIMARY KEY'
       order by kcu.ordinal_position`,
    );

    expect(keys.map((row) => row.column_name)).toEqual(['namespace', 'name']);
  });
});

describe.skipIf(!reachable)('records in the Journal', () => {
  it('are written, listed and removed', async () => {
    const { url } = await freshSchema();

    await withJournal(url, 'migrations', async (journal) => {
      await journal.record({ name: '20260101T000000-first', checksum: 'aaa' });
      await journal.record({ name: '20260102T000000-second', checksum: 'bbb' });

      expect(await journal.executed()).toEqual([
        '20260101T000000-first',
        '20260102T000000-second',
      ]);

      await journal.forget({ name: '20260102T000000-second' });

      expect(await journal.executed()).toEqual(['20260101T000000-first']);
    });
  });

  it('carry the time of application and the Checksum, which umzug cannot express', async () => {
    const { url } = await freshSchema();

    const records = await withJournal(url, 'migrations', async (journal) => {
      await journal.record({ name: '20260101T000000-first', checksum: 'abc123' });

      return journal.records();
    });

    expect(records).toEqual([
      {
        name: '20260101T000000-first',
        checksum: 'abc123',
        appliedAt: expect.any(Date),
      },
    ]);
  });

  it('refuse to record the same Migration twice', async () => {
    const { url } = await freshSchema();

    await expect(
      withJournal(url, 'migrations', async (journal) => {
        await journal.record({ name: '20260101T000000-first', checksum: 'aaa' });
        await journal.record({ name: '20260101T000000-first', checksum: 'bbb' });
      }),
    ).rejects.toMatchObject({ kind: 'database' });
  });

  it('are kept apart by Namespace', async () => {
    const { url } = await freshSchema();

    await withConnection(url, async (sql) => {
      const migrations = await openJournal({ sql, namespace: 'migrations' });
      const seeders = await openJournal({ sql, namespace: 'seeders' });

      await migrations.record({ name: '20260101T000000-same', checksum: 'a' });
      await seeders.record({ name: '20260101T000000-same', checksum: 'b' });

      expect(await migrations.executed()).toEqual(['20260101T000000-same']);
      expect(await seeders.executed()).toEqual(['20260101T000000-same']);
      expect((await migrations.records())[0]?.checksum).toBe('a');
      expect((await seeders.records())[0]?.checksum).toBe('b');
    });
  });
});

describe.skipIf(!reachable)('an unreachable database', () => {
  it('is reported as a readable failure rather than a driver error', async () => {
    await expect(
      withJournal('postgres://nobody:nobody@127.0.0.1:1/none', 'migrations', async () => undefined),
    ).rejects.toMatchObject({ kind: 'database', hint: expect.any(String) });
  });
});
