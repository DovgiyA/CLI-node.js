import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultConfigFilename } from '../src/config/locate.js';
import { loadConfig } from '../src/config/load.js';
import { exampleMigrationFile } from '../src/init/artifacts.js';
import { run } from '../src/run.js';
import { createTestIo } from './support/io.js';
import { linkMigratePackage, packageEntry } from './support/package.js';
import { isPostgresReachable, useTestSchemas } from './support/postgres.js';
import { createProject } from './support/project.js';

const reachable = await isPostgresReachable();
const freshSchema = useTestSchemas(afterEach);

describe('migrate init in an empty project', () => {
  it('creates the config, migrations with an example, and a seeders folder', async () => {
    const { cwd, io } = await createProject();

    const code = await run(['init'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain(`created ${defaultConfigFilename}`);
    expect(io.stdoutText()).toContain(`created migrations/${exampleMigrationFile}`);
    expect(io.stdoutText()).toContain('created migrations');
    expect(io.stdoutText()).toContain('created seeders');
    expect(io.stdoutText()).toContain('migrate:up');

    await expect(access(join(cwd, defaultConfigFilename))).resolves.toBeUndefined();
    await expect(access(join(cwd, 'migrations', exampleMigrationFile))).resolves.toBeUndefined();
    await expect(access(join(cwd, 'seeders'))).resolves.toBeUndefined();
  });

  it('loads the generated config when DATABASE_URL is set', async () => {
    const { cwd } = await createProject();
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/app');

    await run(['init'], createTestIo({ cwd }));

    await expect(loadConfig({ cwd })).resolves.toMatchObject({
      database: 'postgres://user:pass@localhost:5432/app',
      migrationsDir: join(cwd, 'migrations'),
    });

    vi.unstubAllEnvs();
  });

  it('does not change an existing package.json', async () => {
    const original = '{"name":"demo","version":"1.0.0"}\n';
    const { cwd, io } = await createProject({ 'package.json': original });

    expect(await run(['init'], io)).toBe(0);
    expect(await readFile(join(cwd, 'package.json'), 'utf8')).toBe(original);
  });
});

describe('migrate init when run again', () => {
  it('skips every existing artifact and still succeeds', async () => {
    const { io } = await createProject();

    expect(await run(['init'], io)).toBe(0);

    const code = await run(['init'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain(`skipped ${defaultConfigFilename}`);
    expect(io.stdoutText()).toContain(`skipped migrations/${exampleMigrationFile}`);
    expect(io.stdoutText()).toContain('skipped migrations');
    expect(io.stdoutText()).toContain('skipped seeders');
  });
});

describe('migrate init over a partial structure', () => {
  it('creates only what is still missing', async () => {
    const { cwd, io } = await createProject({
      [defaultConfigFilename]: "export default { database: 'postgres://localhost/db' };",
    });
    await mkdir(join(cwd, 'migrations'));

    const code = await run(['init'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain(`skipped ${defaultConfigFilename}`);
    expect(io.stdoutText()).toContain('skipped migrations');
    expect(io.stdoutText()).toContain(`created migrations/${exampleMigrationFile}`);
    expect(io.stdoutText()).toContain('created seeders');
  });
});

describe.skipIf(!reachable || packageEntry === undefined)(
  'the generated example migration',
  () => {
    it('applies and reverts without edits', async () => {
      const schema = await freshSchema();
      const { cwd, io } = await createProject();
      vi.stubEnv('DATABASE_URL', schema.url);

      await linkMigratePackage(cwd);
      expect(await run(['init'], io)).toBe(0);
      expect(await run(['up'], io)).toBe(0);
      expect(await run(['down'], io)).toBe(0);

      vi.unstubAllEnvs();
    });
  },
);
