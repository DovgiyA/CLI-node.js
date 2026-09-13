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

const twoMigrations = {
  '20260101T000000-add-users.ts': createsTable('users'),
  '20260102T000000-add-orders.ts': createsTable('orders'),
};

const tablesIn = async (schema: TestSchema): Promise<string[]> => {
  const rows = await schema.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = current_schema() order by table_name`,
  );

  return rows.map((row) => row.table_name);
};

describe.skipIf(!reachable)('migrate up from scratch', () => {
  it('applies every Pending Migration and lists what it applied', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, twoMigrations);

    const code = await run(['up'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('20260101T000000-add-users');
    expect(io.stdoutText()).toContain('20260102T000000-add-orders');
    expect(await tablesIn(schema)).toContain('users');
    expect(await tablesIn(schema)).toContain('orders');
  });

  it('reports exactly what it applied as one machine-readable structure', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, twoMigrations);

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      applied: ['20260101T000000-add-users', '20260102T000000-add-orders'],
    });
  });

  it('applies them in timestamp order', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, {
      // The second Migration only works if the first one ran before it.
      '20260101T000000-add-users.ts': createsTable('users'),
      '20260102T000000-add-users-column.ts': `
        export default {
          up: async ({ sql }) => {
            await sql.query('alter table users add column email text');
          },
        };
      `,
    });

    expect(await run(['up'], io)).toBe(0);
  });

  it('records Namespace, name, the time of application and the Checksum in the Journal', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, twoMigrations);

    await run(['up'], io);

    const records = await schema.query<{
      namespace: string;
      name: string;
      applied_at: Date;
      checksum: string;
    }>(`select namespace, name, applied_at, checksum from __migrations order by name`);

    expect(records).toEqual([
      {
        namespace: 'migrations',
        name: '20260101T000000-add-users',
        applied_at: expect.any(Date),
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        namespace: 'migrations',
        name: '20260102T000000-add-orders',
        applied_at: expect.any(Date),
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it('hands the Migration a Postgres client and a logger', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, {
      '20260101T000000-uses-context.ts': `
        export default {
          up: async ({ sql, logger }) => {
            logger.info('внутри миграции');
            const { rows } = await sql.query('select 1 as one');
            await sql.query('create table proof (one integer)');
            await sql.query('insert into proof (one) values ($1)', [rows[0].one]);
          },
        };
      `,
    });

    expect(await run(['up'], io)).toBe(0);
    expect(io.stderrText()).toContain('внутри миграции');
    await expect(schema.query('select one from proof')).resolves.toEqual([{ one: 1 }]);
  });
});

describe.skipIf(!reachable)('migrate up with nothing to do', () => {
  it('says so and succeeds when every Migration is already Executed', async () => {
    const schema = await freshSchema();
    const { io: first } = await projectOn(schema, twoMigrations);
    await run(['up'], first);

    const { io } = await projectOn(schema, twoMigrations);
    const code = await run(['up'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Применять нечего');
  });

  it('succeeds on an empty Migration folder', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema);

    expect(await run(['up'], io)).toBe(0);
  });

  it('leaves the Journal untouched on a second Run', async () => {
    const schema = await freshSchema();
    const { io: first } = await projectOn(schema, twoMigrations);
    await run(['up'], first);

    const before = await schema.query<{ name: string; applied_at: Date }>(
      `select name, applied_at from __migrations order by name`,
    );

    const { io } = await projectOn(schema, twoMigrations);
    await run(['up'], io);

    await expect(
      schema.query(`select name, applied_at from __migrations order by name`),
    ).resolves.toEqual(before);
  });
});

describe.skipIf(!reachable)('migrate up over already Executed Migration', () => {
  it('applies only the new ones', async () => {
    const schema = await freshSchema();
    const { io: first } = await projectOn(schema, {
      '20260101T000000-add-users.ts': createsTable('users'),
    });
    await run(['up'], first);

    const { io } = await projectOn(schema, twoMigrations);
    const code = await run(['up'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('20260102T000000-add-orders');
    expect(io.stdoutText()).not.toContain('20260101T000000-add-users');
  });

  it('shows them all as executed in status afterwards', async () => {
    const schema = await freshSchema();
    const { io: applying } = await projectOn(schema, twoMigrations);
    await run(['up'], applying);

    const { io } = await projectOn(schema, twoMigrations);
    await run(['status', '--logger', 'json'], io);

    const result = JSON.parse(io.stdoutText()) as {
      migrations: { name: string; state: string; appliedAt: string | null }[];
    };

    expect(result.migrations).toEqual([
      {
        name: '20260101T000000-add-users',
        state: 'executed',
        appliedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        checksum: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
      {
        name: '20260102T000000-add-orders',
        state: 'executed',
        appliedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        checksum: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    ]);
  });
});

describe.skipIf(!reachable)('a Migration that fails', () => {
  const failing = {
    '20260101T000000-add-users.ts': createsTable('users'),
    '20260102T000000-broken.ts': `
      export default {
        up: async ({ sql }) => {
          await sql.query('this is not sql');
        },
      };
    `,
    '20260103T000000-add-orders.ts': createsTable('orders'),
  };

  it('fails with exit code 1 and names the Migration that broke', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, failing);

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'migration',
        msg: expect.stringContaining('20260102T000000-broken'),
        hint: expect.any(String),
      }),
    ]);
  });

  it('keeps what succeeded before it and does not reach what comes after', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, failing);

    await run(['up'], io);

    const applied = await schema.query<{ name: string }>(
      `select name from __migrations order by name`,
    );

    expect(applied.map((record) => record.name)).toEqual(['20260101T000000-add-users']);
    expect(await tablesIn(schema)).toContain('users');
    expect(await tablesIn(schema)).not.toContain('orders');
  });
});
