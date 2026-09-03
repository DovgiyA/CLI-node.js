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
      await sql.query('drop table if exists ${table}');
    },
  };
`;

const failingMigration = `
  export default {
    up: async () => {
      throw new Error('boom');
    },
  };
`;

const threeMigrations = {
  '20260101T000000-first.ts': createsTable('first'),
  '20260102T000000-second.ts': createsTable('second'),
  '20260103T000000-third.ts': failingMigration,
};

const journalNames = async (schema: TestSchema): Promise<string[]> => {
  const rows = await schema.query<{ name: string }>(
    `select name from __migrations where namespace = 'migrations' order by name`,
  );

  return rows.map((row) => row.name);
};

const tablesIn = async (schema: TestSchema): Promise<string[]> => {
  const rows = await schema.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = current_schema() order by table_name`,
  );

  return rows.map((row) => row.table_name);
};

describe.skipIf(!reachable)('transaction mode all', () => {
  it('rolls back schema and Journal when the last Migration fails', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, threeMigrations, { transaction: 'all' });

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(await journalNames(schema)).toEqual([]);
    expect(await tablesIn(schema)).toEqual(['__migrations']);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'migration',
        msg: expect.stringContaining('20260103T000000-third'),
        hint: expect.stringMatching(/откатан|журнал не изменён/i),
      }),
    ]);
  });
});

describe.skipIf(!reachable)('transaction mode each', () => {
  it('keeps successful predecessors in the schema and Journal when a later one fails', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, threeMigrations, { transaction: 'each' });

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-first',
      '20260102T000000-second',
    ]);
    expect(await tablesIn(schema)).toEqual(expect.arrayContaining(['first', 'second', '__migrations']));
    expect(await tablesIn(schema)).not.toContain('third');
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'migration',
        hint: expect.stringMatching(/20260101T000000-first.*20260102T000000-second/s),
      }),
    ]);
  });
});

describe.skipIf(!reachable)('transaction mode none', () => {
  it('does not roll back successful predecessors', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, threeMigrations, { transaction: 'none' });

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-first',
      '20260102T000000-second',
    ]);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'migration',
        hint: expect.stringMatching(/Транзакций нет/i),
      }),
    ]);
  });
});

describe.skipIf(!reachable)('a Migration that opts out of transactions', () => {
  it('runs outside a transaction even when the Config says each', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(
      schema,
      {
        '20260101T000000-users.ts': createsTable('users'),
        '20260102T000000-index.ts': `
          export default {
            transaction: false,
            up: async ({ sql }) => {
              await sql.query('create index concurrently users_id_idx on users (id)');
            },
            down: async ({ sql }) => {
              await sql.query('drop index concurrently if exists users_id_idx');
            },
          };
        `,
      },
      { transaction: 'each' },
    );

    expect(await run(['up'], io)).toBe(0);
    expect(await journalNames(schema)).toEqual([
      '20260101T000000-users',
      '20260102T000000-index',
    ]);
  });
});
