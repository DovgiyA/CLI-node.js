import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrationFileName, slugify } from '../src/migrations/slug.js';
import { run } from '../src/run.js';
import { linkMigratePackage, packageEntry } from './support/package.js';
import { isPostgresReachable, useTestSchemas } from './support/postgres.js';
import { createTestIo } from './support/io.js';
import { createProject, projectOn } from './support/project.js';

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('add-users-table')).toBe('add-users-table');
  });

  it('turns spaces and capitals into a hyphenated slug', () => {
    expect(slugify('Add Users Table')).toBe('add-users-table');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
});

describe('migrationFileName', () => {
  it('prefixes the slug with a compact timestamp', () => {
    const name = migrationFileName('add-users-table', new Date('2025-10-14T12:00:00'));

    expect(name).toBe('20251014T120000-add-users-table.ts');
  });
});

describe('migrate create without a database', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a timestamped migration file for a normal slug', async () => {
    const { cwd, io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db' };`,
    });
    await mkdir(join(cwd, 'migrations'));

    const code = await run(['create', 'add-users-table'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('20260115T120000-add-users-table.ts');

    const contents = await readFile(
      join(cwd, 'migrations', '20260115T120000-add-users-table.ts'),
      'utf8',
    );

    expect(contents).toContain('defineMigration');
    expect(contents).toContain('// transaction: false');
    expect(contents).toContain('@alex/migrate');
  });

  it('slugifies arguments with spaces and capitals', async () => {
    const { cwd, io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db' };`,
    });
    await mkdir(join(cwd, 'migrations'));

    const code = await run(['create', 'Add Users Table'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('20260115T120000-add-users-table.ts');
  });

  it('fails without creating a file when the slug is empty', async () => {
    const { cwd, io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db' };`,
    });
    await mkdir(join(cwd, 'migrations'));

    const code = await run(['create', '   '], io);

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(io.stderrText()).toContain('имя миграции');
    expect(await readdir(join(cwd, 'migrations'))).toEqual([]);
  });

  it('fails when no slug argument is given', async () => {
    const { cwd, io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db' };`,
    });
    await mkdir(join(cwd, 'migrations'));

    const code = await run(['create'], io);

    expect(code).toBe(1);
    expect(await readdir(join(cwd, 'migrations'))).toEqual([]);
  });

  it('reports a readable error when the migrations folder is missing', async () => {
    const { io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db' };`,
    });

    const code = await run(['create', 'add-users-table'], io);

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Папки с миграциями нет');
  });

  it('does not overwrite an existing file with the same name', async () => {
    const { cwd, io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db' };`,
    });
    const dir = join(cwd, 'migrations');
    await mkdir(dir);
    await writeFile(join(dir, '20260115T120000-add-users-table.ts'), 'original', 'utf8');

    const code = await run(['create', 'add-users-table'], io);

    expect(code).toBe(1);
    expect(await readFile(join(dir, '20260115T120000-add-users-table.ts'), 'utf8')).toBe('original');
  });
});

const reachable = await isPostgresReachable();
const freshSchema = useTestSchemas(afterEach);

describe.skipIf(!reachable || packageEntry === undefined)(
  'migrate create against a database',
  () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T12:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the created migration as pending, then applies and reverts it', async () => {
      const schema = await freshSchema();
      const { cwd, io } = await projectOn(schema);
      await linkMigratePackage(cwd);

      expect(await run(['create', 'create-test-table'], io)).toBe(0);

      const statusIo = createTestIo({ cwd });
      expect(await run(['status', '--logger', 'json'], statusIo)).toBe(0);
      expect(JSON.parse(statusIo.stdoutText())).toEqual({
        namespace: 'migrations',
        migrations: [
          expect.objectContaining({
            name: '20260115T120000-create-test-table',
            state: 'pending',
          }),
        ],
      });

      expect(await run(['up'], io)).toBe(0);
      expect(await run(['down'], io)).toBe(0);
    });
  },
);
