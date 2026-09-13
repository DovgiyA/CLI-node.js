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

describe.skipIf(!reachable)('dangerous down protection', () => {
  it('does not ask for confirmation in dev', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, usersMigration, { env: 'dev' });

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    expect(await run(['down', '--logger', 'json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText().trim().split('\n').at(-1)!)).toEqual({
      namespace: 'migrations',
      reverted: ['20260101T000000-users'],
    });
  });

  it('requires --force outside dev when there is no terminal', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, usersMigration, { env: 'prod' });

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    expect(await run(['down', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'confirmation',
        hint: expect.stringMatching(/--force/i),
      }),
    ]);

    const rows = await schema.query<{ name: string }>(
      `select name from __migrations where namespace = 'migrations'`,
    );

    expect(rows).toHaveLength(1);
  });

  it('allows down outside dev with --force and no terminal', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, usersMigration, { env: 'prod' });

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    expect(await run(['down', '--force', '--logger', 'json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText().trim().split('\n').at(-1)!)).toEqual({
      namespace: 'migrations',
      reverted: ['20260101T000000-users'],
    });
  });

  it('does not protect up outside dev', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, usersMigration, { env: 'prod' });

    expect(await run(['up', '--logger', 'json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      applied: ['20260101T000000-users'],
    });
  });
});
