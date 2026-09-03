import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '../../src/config/types.js';
import { createTestIo, type TestIo } from './io.js';

export type Project = {
  cwd: string;
  io: TestIo;
};

/**
 * A throwaway consumer project: the only thing that ties the CLI to it is the
 * Config file, so tests build one the same way a user would.
 */
export const createProject = async (files: Record<string, string> = {}, env: NodeJS.ProcessEnv = {}): Promise<Project> => {
  const cwd = await mkdtemp(join(tmpdir(), 'migrate-project-'));

  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(join(cwd, name), contents, 'utf8')),
  );

  return { cwd, io: createTestIo({ cwd, env }) };
};

/**
 * A consumer project whose Config points at the given schema, with the given
 * Migration files already in place. This is how every test that talks to the
 * database gets its project.
 */
export const projectOn = async (
  schema: { url: string },
  migrations: Record<string, string> = {},
  config: Partial<Pick<Config, 'transaction' | 'env'>> = {},
  seeders: Record<string, string> = {},
): Promise<Project> => {
  const extras = [
    config.transaction === undefined ? '' : `, transaction: '${config.transaction}'`,
    config.env === undefined ? '' : `, env: '${config.env}'`,
  ].join('');

  const project = await createProject({
    'migrator.config.ts': `export default { database: '${schema.url}'${extras} };`,
  });

  const migrationsDir = join(project.cwd, 'migrations');
  await mkdir(migrationsDir);

  await Promise.all(
    Object.entries(migrations).map(([name, contents]) =>
      writeFile(join(migrationsDir, name), contents, 'utf8'),
    ),
  );

  if (Object.keys(seeders).length > 0) {
    const seedersDir = join(project.cwd, 'seeders');
    await mkdir(seedersDir);

    await Promise.all(
      Object.entries(seeders).map(([name, contents]) =>
        writeFile(join(seedersDir, name), contents, 'utf8'),
      ),
    );
  }

  return project;
};

export const validConfig = `
export default {
  database: 'postgres://migrate:migrate@localhost:54329/migrate',
};
`;
