import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createProject } from './support/project.js';

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(packageRoot, 'dist', 'cli.js');

type BinResult = { code: number; stdout: string; stderr: string };

const execBin = async (args: string[], cwd: string): Promise<BinResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
};

/**
 * Vitest transpiles TypeScript itself, which hides whether the CLI can load a
 * consumer project's TypeScript Config at an honest Node start. Only a real
 * subprocess against the built bin proves it.
 */
describe.skipIf(!existsSync(bin))('the built bin loading a TypeScript Config', () => {
  it('runs a Config function written in TypeScript and reports the loaded state', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        type Env = 'dev' | 'prod';

        export default (env: Env) => ({
          database: env === 'prod' ? 'postgres://prod/db' : 'postgres://localhost/db',
          transaction: 'all' as const,
        });
      `,
    });

    const { code, stdout, stderr } = await execBin(['up', '--logger', 'json'], cwd);

    // The project has no Migration folder, so the failure that proves the
    // Config was loaded and understood is the one about the folder.
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr.trim())).toMatchObject({ kind: 'migrations' });
  });

  it('reports an invalid field from a TypeScript Config instead of a syntax error', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        export default {
          database: 'postgres://localhost/db',
          transaction: 'sometimes',
        };
      `,
    });

    const { code, stderr } = await execBin(['up', '--logger', 'json'], cwd);

    expect(code).toBe(1);
    expect(JSON.parse(stderr.trim())).toMatchObject({
      kind: 'config',
      msg: expect.stringContaining('transaction'),
    });
  });
});
