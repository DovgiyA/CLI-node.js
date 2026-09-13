import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isPostgresReachable, useTestSchemas } from './support/postgres.js';
import { projectOn } from './support/project.js';
import { slowUpMigration } from './support/lock-migrations.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(packageRoot, 'dist', 'cli.js');

const reachable = await isPostgresReachable();
const freshSchema = useTestSchemas(afterEach);

const collect = (child: ReturnType<typeof spawn>): Promise<{ code: number; stderr: string }> =>
  new Promise((resolve, reject) => {
    let stderr = '';

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });

/**
 * Only a real subprocess proves the built bin takes the Lock and exits 1 when
 * another process already holds it.
 */
describe.skipIf(!reachable || !existsSync(bin))('the built bin under Lock contention', () => {
  it('lets exactly one concurrent up finish and rejects the other with exit code 1', async () => {
    const schema = await freshSchema();
    const first = await projectOn(schema, slowUpMigration);
    const second = await projectOn(schema, slowUpMigration);

    const leader = spawn(process.execPath, [bin, 'up', '--logger', 'json'], { cwd: first.cwd });
    const follower = spawn(process.execPath, [bin, 'up', '--logger', 'json'], { cwd: second.cwd });

    const [leaderResult, followerResult] = await Promise.all([
      collect(leader),
      collect(follower),
    ]);

    expect([leaderResult.code, followerResult.code].sort()).toEqual([0, 1]);

    const failed = leaderResult.code === 1 ? leaderResult : followerResult;
    expect(JSON.parse(failed.stderr.trim())).toMatchObject({
      kind: 'lock',
      hint: expect.stringMatching(/держит Lock с \d{4}-\d{2}-\d{2}T/i),
    });

    const applied = await schema.query<{ name: string }>(
      `select name from __migrations where namespace = 'migrations'`,
    );

    expect(applied).toHaveLength(1);
  });
});
