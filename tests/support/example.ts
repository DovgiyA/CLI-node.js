import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestIo, type TestIo } from './io.js';
import { linkMigratePackage } from './package.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const exampleRoot = join(packageRoot, 'example');

export type ExampleProject = {
  cwd: string;
  io: TestIo;
};

/** Copies the bundled example consumer into an isolated temp directory. */
export const materializeExample = async (databaseUrl: string): Promise<ExampleProject> => {
  const cwd = await mkdtemp(join(tmpdir(), 'migrate-example-'));
  await cp(exampleRoot, cwd, { recursive: true });
  await linkMigratePackage(cwd);

  return {
    cwd,
    io: createTestIo({ cwd, env: { DATABASE_URL: databaseUrl } }),
  };
};
