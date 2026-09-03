import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareByName, discoverMigrations } from '../src/migrations/discover.js';
import { loadMigration } from '../src/migrations/load.js';
import { createProject } from './support/project.js';
import { packageEntry } from './support/package.js';

const withMigrations = async (files: Record<string, string>) => {
  const { cwd } = await createProject();
  const dir = join(cwd, 'migrations');
  await mkdir(dir);

  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(join(dir, name), contents, 'utf8')),
  );

  return { cwd, dir };
};

/**
 * Ordering is asserted on the comparator itself, not only through discovery:
 * the glob happens to return names in order already, so a discovery test alone
 * would still pass with the ordering rule deleted.
 */
describe('the ordering rule', () => {
  it('puts an earlier timestamp first, whatever order it is given them in', () => {
    const shuffled = [
      { name: '20260103T000000-third' },
      { name: '20260101T000000-first' },
      { name: '20260102T000000-second' },
    ];

    expect([...shuffled].sort(compareByName).map((entry) => entry.name)).toEqual([
      '20260101T000000-first',
      '20260102T000000-second',
      '20260103T000000-third',
    ]);
  });

  it('treats equal names as equal, so the order is a total one', () => {
    expect(compareByName({ name: 'same' }, { name: 'same' })).toBe(0);
  });
});

describe('discovering Migration files', () => {
  it('orders them by their timestamp prefix, not by discovery order', async () => {
    const { dir } = await withMigrations({
      '20260102T000000-second.ts': 'export default {};',
      '20260101T000000-first.ts': 'export default {};',
      '20260103T000000-third.ts': 'export default {};',
    });

    const found = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    expect(found.map((file) => file.name)).toEqual([
      '20260101T000000-first',
      '20260102T000000-second',
      '20260103T000000-third',
    ]);
  });

  it('accepts both TypeScript and JavaScript files', async () => {
    const { dir } = await withMigrations({
      '20260101T000000-typescript.ts': 'export default {};',
      '20260102T000000-javascript.js': 'export default {};',
    });

    const found = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    expect(found.map((file) => file.name)).toEqual([
      '20260101T000000-typescript',
      '20260102T000000-javascript',
    ]);
  });

  it('ignores files the pattern does not match', async () => {
    const { dir } = await withMigrations({
      '20260101T000000-real.ts': 'export default {};',
      'README.md': '# notes',
      '20260102T000000-real.sql': 'select 1;',
    });

    const found = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    expect(found.map((file) => file.name)).toEqual(['20260101T000000-real']);
  });

  it('reports an empty list for an empty directory', async () => {
    const { dir } = await withMigrations({});

    await expect(discoverMigrations({ dir, pattern: '*.{ts,js}' })).resolves.toEqual([]);
  });

  it('reports a readable failure when the directory is missing', async () => {
    const { cwd } = await createProject();

    await expect(
      discoverMigrations({ dir: join(cwd, 'nowhere'), pattern: '*.{ts,js}' }),
    ).rejects.toMatchObject({ kind: 'migrations', hint: expect.stringContaining('migrate init') });
  });

  it('computes a Checksum over the raw bytes of the file', async () => {
    const { dir } = await withMigrations({ '20260101T000000-first.ts': 'export default {};' });

    const [before] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    await writeFile(join(dir, '20260101T000000-first.ts'), 'export default {}; // touched', 'utf8');

    const [after] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    expect(before?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(after?.checksum).not.toBe(before?.checksum);
  });
});

describe.skipIf(packageEntry === undefined)(
  'a Migration written with the defineMigration helper',
  () => {
    it('is loaded the same as a plain object, keeping its transaction opt-out', async () => {
      const { dir } = await withMigrations({
        '20260101T000000-helper.ts': `
          import { defineMigration } from '${packageEntry}';

          export default defineMigration({
            transaction: false,
            up: async ({ sql }) => {
              await sql.query('select 1');
            },
            down: async ({ logger }) => {
              logger.info('down');
            },
          });
        `,
      });

      const [file] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });
      const migration = await loadMigration(file!);

      expect(migration.name).toBe('20260101T000000-helper');
      expect(migration.transaction).toBe(false);
      expect(typeof migration.down).toBe('function');
    });
  },
);

describe('loading a Migration file', () => {
  it('exposes the operations declared through defineMigration', async () => {
    const { dir } = await withMigrations({
      '20260101T000000-first.ts': `
        export default {
          up: async () => {},
          down: async () => {},
        };
      `,
    });

    const [file] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });
    const migration = await loadMigration(file!);

    expect(migration.name).toBe('20260101T000000-first');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
    expect(migration.transaction).toBe(true);
  });

  it('carries the per-Migration opt-out of transactions', async () => {
    const { dir } = await withMigrations({
      '20260101T000000-concurrently.ts': `
        export default {
          transaction: false,
          up: async () => {},
          down: async () => {},
        };
      `,
    });

    const [file] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });
    const migration = await loadMigration(file!);

    expect(migration.transaction).toBe(false);
  });

  it('rejects a file that exports no operations', async () => {
    const { dir } = await withMigrations({
      '20260101T000000-broken.ts': `export const up = async () => {};`,
    });

    const [file] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    await expect(loadMigration(file!)).rejects.toMatchObject({
      kind: 'migrations',
      message: expect.stringContaining('20260101T000000-broken'),
    });
  });

  it('rejects a file whose up is not a function', async () => {
    const { dir } = await withMigrations({
      '20260101T000000-broken.ts': `export default { up: 'nope' };`,
    });

    const [file] = await discoverMigrations({ dir, pattern: '*.{ts,js}' });

    await expect(loadMigration(file!)).rejects.toMatchObject({ kind: 'migrations' });
  });
});
