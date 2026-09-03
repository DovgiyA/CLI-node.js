import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/run.js';
import { exampleRoot, materializeExample } from './support/example.js';
import { createTestIo } from './support/io.js';
import { linkMigratePackage, packageEntry } from './support/package.js';
import { isPostgresReachable, useTestSchemas } from './support/postgres.js';
import { createProject } from './support/project.js';

const reachable = await isPostgresReachable();
const freshSchema = useTestSchemas(afterEach);

describe('the bundled example consumer project', () => {
  it('contains a config, migrations and seeders', async () => {
    await expect(access(join(exampleRoot, 'migrator.config.ts'))).resolves.toBeUndefined();
    await expect(access(join(exampleRoot, 'migrations', '20260101T000000-create-widgets.ts'))).resolves.toBeUndefined();
    await expect(access(join(exampleRoot, 'seeders', '20260102T000000-seed-widgets.ts'))).resolves.toBeUndefined();
  });
});

describe.skipIf(!reachable || packageEntry === undefined)('the example project against Postgres', () => {
  it('applies migrations and seeders independently', async () => {
    const schema = await freshSchema();
    vi.stubEnv('DATABASE_URL', schema.url);

    const { io } = await materializeExample(schema.url);

    expect(await run(['up'], io)).toBe(0);
    expect(await run(['seed', 'up'], io)).toBe(0);

    const statusIo = createTestIo({ cwd: io.cwd, env: { DATABASE_URL: schema.url } });
    expect(await run(['status', '--logger', 'json'], statusIo)).toBe(0);
    expect(JSON.parse(statusIo.stdoutText())).toEqual({
      namespace: 'migrations',
      migrations: [
        expect.objectContaining({ name: '20260101T000000-create-widgets', state: 'executed' }),
      ],
    });

    const seedStatusIo = createTestIo({ cwd: io.cwd, env: { DATABASE_URL: schema.url } });
    expect(await run(['seed', 'status', '--logger', 'json'], seedStatusIo)).toBe(0);
    expect(JSON.parse(seedStatusIo.stdoutText())).toEqual({
      namespace: 'seeders',
      migrations: [
        expect.objectContaining({ name: '20260102T000000-seed-widgets', state: 'executed' }),
      ],
    });

    expect(await run(['seed', 'down'], io)).toBe(0);
    expect(await run(['down'], io)).toBe(0);

    vi.unstubAllEnvs();
  });
});

describe.skipIf(!reachable || packageEntry === undefined)('the README walkthrough from scratch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('runs init, create, up, status and down', async () => {
    const schema = await freshSchema();
    vi.stubEnv('DATABASE_URL', schema.url);

    const { cwd, io } = await createProject();
    await linkMigratePackage(cwd);

    expect(await run(['init'], io)).toBe(0);
    expect(await run(['create', 'add-notes-table'], io)).toBe(0);

    const createdPath = join(cwd, 'migrations', '20260301T100000-add-notes-table.ts');
    await writeFile(
      createdPath,
      `export default {
  up: async ({ sql }) => {
    await sql.query('create table notes (id integer primary key, body text not null)');
  },
  down: async ({ sql }) => {
    await sql.query('drop table notes');
  },
};`,
      'utf8',
    );

    expect(await run(['up'], io)).toBe(0);

    const statusIo = createTestIo({ cwd, env: { DATABASE_URL: schema.url } });
    expect(await run(['status', '--logger', 'json'], statusIo)).toBe(0);
    expect(JSON.parse(statusIo.stdoutText())).toEqual({
      namespace: 'migrations',
      migrations: expect.arrayContaining([
        expect.objectContaining({ name: '20260101T000000-example', state: 'executed' }),
        expect.objectContaining({ name: '20260301T100000-add-notes-table', state: 'executed' }),
      ]),
    });

    expect(await run(['down', '--step', '1'], io)).toBe(0);
  });
});
