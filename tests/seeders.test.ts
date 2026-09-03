import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { isPostgresReachable, useTestSchemas, type TestSchema } from './support/postgres.js';
import { createTestIo } from './support/io.js';
import { projectOn } from './support/project.js';

const reachable = await isPostgresReachable();
const freshSchema = useTestSchemas(afterEach);

const createsTable = (table: string) => `
  export default {
    up: async ({ sql }) => {
      await sql.query('create table ${table} (id integer primary key)');
    },
    down: async ({ sql }) => {
      await sql.query('drop table if exists ${table}');
    },
  };
`;

const insertsRow = (table: string, id: number) => `
  export default {
    up: async ({ sql }) => {
      await sql.query('insert into ${table} (id) values (${id})');
    },
    down: async ({ sql }) => {
      await sql.query('delete from ${table} where id = ${id}');
    },
  };
`;

const sameName = '20260101T000000-same';

const journalNames = async (schema: TestSchema, namespace: 'migrations' | 'seeders'): Promise<string[]> => {
  const rows = await schema.query<{ name: string }>(
    `select name from __migrations where namespace = $1 order by name`,
    [namespace],
  );

  return rows.map((row) => row.name);
};

describe.skipIf(!reachable)('seed up and seed down', () => {
  it('applies and reverts Seeder from the seeders folder', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(
      schema,
      { '20260101T000000-add-users.ts': createsTable('users') },
      {},
      { '20260102T000000-add-admin.ts': insertsRow('users', 1) },
    );

    expect(await run(['up'], io)).toBe(0);

    const seedUpIo = createTestIo({ cwd: io.cwd });
    expect(await run(['seed', 'up', '--logger', 'json'], seedUpIo)).toBe(0);
    expect(JSON.parse(seedUpIo.stdoutText())).toEqual({
      namespace: 'seeders',
      applied: ['20260102T000000-add-admin'],
    });

    const seedDownIo = createTestIo({ cwd: io.cwd });
    expect(await run(['seed', 'down', '--logger', 'json'], seedDownIo)).toBe(0);
    expect(JSON.parse(seedDownIo.stdoutText())).toEqual({
      namespace: 'seeders',
      reverted: ['20260102T000000-add-admin'],
    });
  });

  it('supports the same selection flags as migrate up and down', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(
      schema,
      { '20260101T000000-add-users.ts': createsTable('users') },
      {},
      {
        '20260101T000000-first.ts': insertsRow('users', 1),
        '20260102T000000-second.ts': insertsRow('users', 2),
      },
    );

    await run(['up'], io);

    const seedUpIo = createTestIo({ cwd });
    expect(await run(['seed', 'up', '--step', '1', '--logger', 'json'], seedUpIo)).toBe(0);
    expect(JSON.parse(seedUpIo.stdoutText())).toEqual({
      namespace: 'seeders',
      applied: ['20260101T000000-first'],
    });

    const seedDownIo = createTestIo({ cwd });
    expect(await run(['seed', 'down', '--all', '--logger', 'json'], seedDownIo)).toBe(0);
    expect(JSON.parse(seedDownIo.stdoutText())).toEqual({
      namespace: 'seeders',
      reverted: ['20260101T000000-first'],
    });
  });

  it('applies Seeder up to a named file with --to', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(
      schema,
      { '20260101T000000-add-users.ts': createsTable('users') },
      {},
      {
        '20260101T000000-first.ts': insertsRow('users', 1),
        '20260102T000000-second.ts': insertsRow('users', 2),
      },
    );

    await run(['up'], io);

    const seedUpIo = createTestIo({ cwd });
    expect(await run(['seed', 'up', '--to', '20260102T000000-second', '--logger', 'json'], seedUpIo)).toBe(0);
    expect(JSON.parse(seedUpIo.stdoutText())).toEqual({
      namespace: 'seeders',
      applied: ['20260101T000000-first', '20260102T000000-second'],
    });
  });
});

describe.skipIf(!reachable)('Migration and Seeder namespaces', () => {
  it('keep independent Journal state', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(
      schema,
      { '20260101T000000-add-users.ts': createsTable('users') },
      {},
      { '20260102T000000-add-admin.ts': insertsRow('users', 1) },
    );

    await run(['up'], io);
    expect(await journalNames(schema, 'migrations')).toEqual(['20260101T000000-add-users']);
    expect(await journalNames(schema, 'seeders')).toEqual([]);

    await run(['seed', 'up'], io);
    expect(await journalNames(schema, 'seeders')).toEqual(['20260102T000000-add-admin']);

    const statusIo = createTestIo({ cwd });
    expect(await run(['status', '--logger', 'json'], statusIo)).toBe(0);
    expect(JSON.parse(statusIo.stdoutText())).toEqual({
      namespace: 'migrations',
      migrations: [
        expect.objectContaining({ name: '20260101T000000-add-users', state: 'executed' }),
      ],
    });

    const seedStatusIo = createTestIo({ cwd });
    expect(await run(['seed', 'status', '--logger', 'json'], seedStatusIo)).toBe(0);
    expect(JSON.parse(seedStatusIo.stdoutText())).toEqual({
      namespace: 'seeders',
      migrations: [
        expect.objectContaining({ name: '20260102T000000-add-admin', state: 'executed' }),
      ],
    });
  });

  it('do not conflict when a Migration and Seeder share the same name', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(
      schema,
      { [`${sameName}.ts`]: createsTable('shared_name') },
      {},
      { [`${sameName}.ts`]: insertsRow('shared_name', 1) },
    );

    expect(await run(['up'], io)).toBe(0);
    expect(await run(['seed', 'up'], io)).toBe(0);

    expect(await journalNames(schema, 'migrations')).toEqual([sameName]);
    expect(await journalNames(schema, 'seeders')).toEqual([sameName]);
  });
});
