import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { lockNamespace, withAdvisoryLock } from '../src/lock/lock.js';
import { LockBusyError } from '../src/errors.js';
import { isPostgresReachable, useTestSchemas } from './support/postgres.js';
import { projectOn } from './support/project.js';
import {
  failingUpMigration,
  slowDownMigration,
  slowUpMigration,
} from './support/lock-migrations.js';

const reachable = await isPostgresReachable();

const freshSchema = useTestSchemas(afterEach);

const lockHintWithSince = expect.stringMatching(/держит Lock с \d{4}-\d{2}-\d{2}T/i);

describe.skipIf(!reachable)('Lock', () => {
  it('does not let two Runs apply Migration at the same time', async () => {
    const schema = await freshSchema();
    const first = await projectOn(schema, slowUpMigration);
    const second = await projectOn(schema, slowUpMigration);

    const [firstCode, secondCode] = await Promise.all([
      run(['up', '--logger', 'json'], first.io),
      run(['up', '--logger', 'json'], second.io),
    ]);

    expect([firstCode, secondCode].sort()).toEqual([0, 1]);

    const failed = firstCode === 1 ? first : second;
    expect(failed.io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'lock',
        hint: lockHintWithSince,
      }),
    ]);

    const applied = await schema.query<{ name: string }>(
      `select name from __migrations where namespace = 'migrations'`,
    );

    expect(applied).toHaveLength(1);
  });

  it('does not let two Runs revert Migration at the same time', async () => {
    const schema = await freshSchema();
    const first = await projectOn(schema, slowDownMigration);
    const second = await projectOn(schema, slowDownMigration);

    expect(await run(['up'], first.io)).toBe(0);

    const [firstCode, secondCode] = await Promise.all([
      run(['down', '--logger', 'json'], first.io),
      run(['down', '--logger', 'json'], second.io),
    ]);

    expect([firstCode, secondCode].sort()).toEqual([0, 1]);

    const failed = firstCode === 1 ? first : second;
    expect(failed.io.stderrLines()).toEqual([
      expect.objectContaining({
        kind: 'lock',
        hint: lockHintWithSince,
      }),
    ]);

    const applied = await schema.query<{ name: string }>(
      `select name from __migrations where namespace = 'migrations'`,
    );

    expect(applied).toHaveLength(0);
  });

  it('releases Lock when the holding connection closes', async () => {
    const schema = await freshSchema();
    const url = schema.url;
    const client = new Client({ connectionString: url });

    await client.connect();

    try {
      const { rows } = await client.query<{ acquired: boolean }>(
        `select pg_try_advisory_lock(hashtext($1), hashtext($2)) as acquired`,
        [lockNamespace, url],
      );

      expect(rows[0]?.acquired).toBe(true);

      await expect(withAdvisoryLock(url, async () => undefined)).rejects.toBeInstanceOf(LockBusyError);
    } finally {
      await client.end();
    }

    await expect(withAdvisoryLock(url, async () => 'ok')).resolves.toBe('ok');
  });

  it('releases Lock after a Run that fails', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, failingUpMigration);

    expect(await run(['up', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines()).toContainEqual(expect.objectContaining({ kind: 'migration' }));

    await expect(withAdvisoryLock(schema.url, async () => 'ok')).resolves.toBe('ok');
    expect(await run(['up', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines().at(-1)).toMatchObject({ kind: 'migration' });
  });
});
