import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { isPostgresReachable, useTestSchemas } from './support/postgres.js';
import { projectOn } from './support/project.js';

const reachable = await isPostgresReachable();

const freshSchema = useTestSchemas(afterEach);

const usersMigration = {
  '20260101T000000-users.ts': `
    export default {
      up: async ({ sql }) => {
        await sql.query('create table users (id integer primary key)');
      },
      down: async ({ sql }) => {
        await sql.query('drop table if exists users');
      },
    };
  `,
};

const usersAndOrders = {
  ...usersMigration,
  '20260102T000000-orders.ts': `
    export default {
      up: async ({ sql }) => {
        await sql.query('create table orders (id integer primary key)');
      },
      down: async ({ sql }) => {
        await sql.query('drop table if exists orders');
      },
    };
  `,
};

describe.skipIf(!reachable)('Drift', () => {
  it('warns when an applied Migration file was edited', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(schema, usersMigration);

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);

    const path = join(cwd, 'migrations', '20260101T000000-users.ts');
    await writeFile(path, `${await readFile(path, 'utf8')}\n// edited\n`);

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    expect(io.stderrLines()).toContainEqual(
      expect.objectContaining({
        kind: 'drift',
        migration: '20260101T000000-users',
      }),
    );
  });

  it('fails with exit code 1 when --strict is set', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(schema, usersMigration);

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);

    const path = join(cwd, 'migrations', '20260101T000000-users.ts');
    await writeFile(path, `${await readFile(path, 'utf8')}\n// edited\n`);

    expect(await run(['status', '--strict', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'drift',
        msg: expect.stringContaining('20260101T000000-users'),
      }),
    ]);
    expect(await run(['up', '--strict', '--logger', 'json'], io)).toBe(1);
  });
});

describe.skipIf(!reachable)('Missing', () => {
  it('shows a Journal record without a file as missing in status', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(schema, usersMigration);

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);

    await unlink(join(cwd, 'migrations', '20260101T000000-users.ts'));

    expect(await run(['status', '--logger', 'json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText().trim().split('\n').at(-1)!)).toEqual({
      namespace: 'migrations',
      migrations: [
        expect.objectContaining({
          name: '20260101T000000-users',
          state: 'missing',
          appliedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      ],
    });
  });

  it('blocks down with a readable error when the Migration to revert is missing', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(schema, usersMigration);

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    await unlink(join(cwd, 'migrations', '20260101T000000-users.ts'));

    expect(await run(['down', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'missing',
        msg: expect.stringMatching(/20260101T000000-users.*откатывать нечем/i),
      }),
    ]);
  });

  it('still applies new Migration when an older one is missing', async () => {
    const schema = await freshSchema();
    const { cwd, io } = await projectOn(schema, usersAndOrders);

    expect(await run(['up', '--to', '20260101T000000-users', '--logger', 'json'], io)).toBe(0);
    await unlink(join(cwd, 'migrations', '20260101T000000-users.ts'));

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText().trim().split('\n').at(-1)!)).toEqual({
      namespace: 'migrations',
      applied: ['20260102T000000-orders'],
    });
  });
});
