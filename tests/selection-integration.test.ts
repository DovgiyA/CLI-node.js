import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { isPostgresReachable, useTestSchemas, type TestSchema } from './support/postgres.js';
import { projectOn } from './support/project.js';

const reachable = await isPostgresReachable();

const freshSchema = useTestSchemas(afterEach);

const createsTable = (table: string) => `
  export default {
    up: async ({ sql }) => {
      await sql.query('create table ${table} (id integer primary key)');
    },
    down: async ({ sql }) => {
      await sql.query('drop table ${table}');
    },
  };
`;

const fourMigrations = {
  '20260101T000000-add-users.ts': createsTable('users'),
  '20260102T000000-add-orders.ts': createsTable('orders'),
  '20260103T000000-add-items.ts': createsTable('items'),
  '20260104T000000-add-tags.ts': createsTable('tags'),
};

const tablesIn = async (schema: TestSchema): Promise<string[]> => {
  const rows = await schema.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = current_schema() order by table_name`,
  );

  return rows.map((row) => row.table_name);
};

const journalNames = async (schema: TestSchema): Promise<string[]> => {
  const rows = await schema.query<{ name: string }>(
    `select name from __migrations where namespace = 'migrations' order by name`,
  );

  return rows.map((row) => row.name);
};

const applyAll = async (schema: TestSchema) => {
  const { io } = await projectOn(schema, fourMigrations);
  await run(['up'], io);
};

describe.skipIf(!reachable)('migrate up with --step and --to', () => {
  it('applies only the next N Pending Migration with --step', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, fourMigrations);

    const code = await run(['up', '--step', '2', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      applied: ['20260101T000000-add-users', '20260102T000000-add-orders'],
    });
    expect(await tablesIn(schema)).toEqual(expect.arrayContaining(['users', 'orders']));
    expect(await tablesIn(schema)).not.toContain('items');
  });

  it('applies Pending Migration up to and including the named one with --to', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, fourMigrations);

    const code = await run(['up', '--to', '20260103T000000-add-items', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      applied: [
        '20260101T000000-add-users',
        '20260102T000000-add-orders',
        '20260103T000000-add-items',
      ],
    });
    expect(await tablesIn(schema)).not.toContain('tags');
  });

  it('succeeds with an empty list when --to names the last already Executed Migration', async () => {
    const schema = await freshSchema();
    const { io: applying } = await projectOn(schema, fourMigrations);
    await run(['up', '--to', '20260102T000000-add-orders'], applying);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['up', '--to', '20260102T000000-add-orders', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({ namespace: 'migrations', applied: [] });
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-add-users',
      '20260102T000000-add-orders',
    ]);
  });
});

describe.skipIf(!reachable)('migrate down', () => {
  it('without flags reverts exactly the last Executed Migration', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['down', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      reverted: ['20260104T000000-add-tags'],
    });
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-add-users',
      '20260102T000000-add-orders',
      '20260103T000000-add-items',
    ]);
    expect(await tablesIn(schema)).not.toContain('tags');
    expect(await tablesIn(schema)).toContain('items');
  });

  it('reverts N last Executed Migration with --step', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['down', '--step', '2', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      reverted: ['20260104T000000-add-tags', '20260103T000000-add-items'],
    });
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-add-users',
      '20260102T000000-add-orders',
    ]);
  });

  it('keeps the named Migration applied with --to', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['down', '--to', '20260102T000000-add-orders', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      reverted: ['20260104T000000-add-tags', '20260103T000000-add-items'],
    });
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-add-users',
      '20260102T000000-add-orders',
    ]);
    expect(await tablesIn(schema)).toContain('orders');
    expect(await tablesIn(schema)).not.toContain('items');
    expect(await tablesIn(schema)).not.toContain('tags');
  });

  it('succeeds with an empty list when --to names the last already Executed Migration', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['down', '--to', '20260104T000000-add-tags', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      reverted: [],
      idle: 'already-at-target',
    });
    expect(await journalNames(schema)).toHaveLength(4);
  });

  it('names the right reason in pretty output when --to is already satisfied', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    await run(['down', '--to', '20260104T000000-add-tags'], io);

    expect(io.stdoutText()).toContain('последняя применённая');
    expect(io.stdoutText()).not.toContain('не применена');
  });

  it('hands the Migration a Postgres client and logger on the way down', async () => {
    const schema = await freshSchema();
    const proofMigration = {
      '20260101T000000-proof.ts': `
        export default {
          up: async ({ sql }) => {
            await sql.query('create table proof (id integer primary key)');
          },
          down: async ({ sql, logger }) => {
            logger.info('откатываю proof');
            await sql.query('drop table proof');
          },
        };
      `,
    };

    const { io: applying } = await projectOn(schema, proofMigration);
    await run(['up'], applying);

    const { io } = await projectOn(schema, proofMigration);
    await run(['down'], io);

    expect(io.stderrText()).toContain('откатываю proof');
    expect(await tablesIn(schema)).not.toContain('proof');
  });

  it('reverts every Executed Migration with --all', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['down', '--all', '--logger', 'json'], io);

    expect(code).toBe(0);
    const result = JSON.parse(io.stdoutText()) as { reverted: string[] };

    expect(result.reverted).toEqual([
      '20260104T000000-add-tags',
      '20260103T000000-add-items',
      '20260102T000000-add-orders',
      '20260101T000000-add-users',
    ]);
    expect(await journalNames(schema)).toEqual([]);
    expect(await tablesIn(schema)).toEqual(['__migrations']);
  });
});

describe.skipIf(!reachable)('invalid selection', () => {
  it('rejects --to and --step together on up', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, fourMigrations);

    const code = await run(
      ['up', '--step', '1', '--to', '20260101T000000-add-users', '--logger', 'json'],
      io,
    );

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({ kind: 'selection', msg: expect.stringContaining('--step') }),
    ]);
  });

  it('rejects --to and --step together on down', async () => {
    const schema = await freshSchema();
    await applyAll(schema);
    const { io } = await projectOn(schema, fourMigrations);

    const code = await run(
      ['down', '--step', '1', '--to', '20260101T000000-add-users', '--logger', 'json'],
      io,
    );

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(await journalNames(schema)).toHaveLength(4);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'selection',
        msg: expect.stringMatching(/(--step.*--to|--to.*--step)/),
      }),
    ]);
  });

  it('rejects --all and --to together on down', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, fourMigrations);

    const code = await run(
      ['down', '--all', '--to', '20260101T000000-add-users', '--logger', 'json'],
      io,
    );

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'selection',
        msg: expect.stringMatching(/--all.*--to|--to.*--all/),
      }),
    ]);
  });

  it('rejects an unknown --to name on up without applying anything', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, fourMigrations);

    const code = await run(['up', '--to', '20260199T000000-nobody', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(await tablesIn(schema)).not.toContain('users');
    expect(await tablesIn(schema)).not.toContain('orders');
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'selection',
        msg: expect.stringContaining('20260199T000000-nobody'),
      }),
    ]);
  });

  it('rejects an unknown --to name on down without reverting anything', async () => {
    const schema = await freshSchema();
    await applyAll(schema);

    const { io } = await projectOn(schema, fourMigrations);
    const code = await run(['down', '--to', '20260199T000000-nobody', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(await journalNames(schema)).toHaveLength(4);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'selection',
        msg: expect.stringContaining('20260199T000000-nobody'),
      }),
    ]);
  });
});
