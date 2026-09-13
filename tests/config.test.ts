import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/load.js';
import { packageEntry } from './support/package.js';
import { createProject, validConfig } from './support/project.js';

const load = (cwd: string, options: { env?: string; path?: string; nodeEnv?: string } = {}) =>
  loadConfig({
    cwd,
    ...(options.path === undefined ? {} : { explicitPath: options.path }),
    ...(options.env === undefined ? {} : { envFlag: options.env }),
    ...(options.nodeEnv === undefined ? {} : { nodeEnv: options.nodeEnv }),
  });

describe('a project with no Config', () => {
  it('is rejected with the path that was searched', async () => {
    const { cwd } = await createProject();

    await expect(load(cwd)).rejects.toMatchObject({
      kind: 'config',
      message: expect.stringContaining('migrator.config.ts'),
    });
  });

  it('is rejected when the path given by --config does not exist', async () => {
    const { cwd } = await createProject({ 'migrator.config.ts': validConfig });

    await expect(load(cwd, { path: 'migrator.stage.ts' })).rejects.toMatchObject({
      message: expect.stringContaining('migrator.stage.ts'),
    });
  });
});

describe.skipIf(packageEntry === undefined)('a Config written with the defineConfig helper', () => {
  it('loads the same as a plain export', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        import { defineConfig } from '${packageEntry}';

        export default defineConfig({
          database: 'postgres://localhost/db',
          transaction: 'all',
        });
      `,
    });

    await expect(load(cwd)).resolves.toMatchObject({
      database: 'postgres://localhost/db',
      transaction: 'all',
    });
  });

  it('loads a factory wrapped by the helper', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        import { defineConfig } from '${packageEntry}';

        export default defineConfig((env: string) => ({
          database: \`postgres://localhost/\${env}\`,
        }));
      `,
    });

    await expect(load(cwd, { env: 'stage' })).resolves.toMatchObject({
      database: 'postgres://localhost/stage',
    });
  });
});

describe('a Config factory that is not synchronous', () => {
  it('is rejected by naming the real problem instead of a missing field', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        export default async () => ({ database: 'postgres://localhost/db' });
      `,
    });

    await expect(load(cwd)).rejects.toMatchObject({
      kind: 'config',
      message: expect.stringContaining('Promise'),
      hint: expect.stringContaining('синхронной'),
    });
  });
});

describe('a Config exported as an object', () => {
  it('is loaded and filled in with defaults', async () => {
    const { cwd } = await createProject({ 'migrator.config.ts': validConfig });

    const config = await load(cwd);

    expect(config).toMatchObject({
      database: 'postgres://migrate:migrate@localhost:54329/migrate',
      transaction: 'each',
      logger: 'pretty',
      storage: 'table',
      env: 'dev',
    });
    expect(config.migrationsDir).toBe(`${cwd}/migrations`);
    expect(config.seedersDir).toBe(`${cwd}/seeders`);
  });

  it('keeps explicit values instead of defaults', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        export default {
          database: 'postgres://localhost/db',
          migrationsDir: 'db/changes',
          pattern: '*.ts',
          transaction: 'all',
          logger: 'json',
        };
      `,
    });

    const config = await load(cwd);

    expect(config).toMatchObject({ transaction: 'all', logger: 'json', pattern: '*.ts' });
    expect(config.migrationsDir).toBe(`${cwd}/db/changes`);
  });
});

describe('a Config exported as a function of the environment', () => {
  const envAwareConfig = `
    export default (env) => ({
      database: env === 'prod' ? 'postgres://prod/db' : 'postgres://localhost/db',
    });
  `;

  it('receives dev by default', async () => {
    const { cwd } = await createProject({ 'migrator.config.ts': envAwareConfig });

    await expect(load(cwd)).resolves.toMatchObject({
      database: 'postgres://localhost/db',
      env: 'dev',
    });
  });

  it('receives the environment named by the --env flag', async () => {
    const { cwd } = await createProject({ 'migrator.config.ts': envAwareConfig });

    await expect(load(cwd, { env: 'prod' })).resolves.toMatchObject({
      database: 'postgres://prod/db',
      env: 'prod',
    });
  });

  it('falls back to NODE_ENV when no flag is given', async () => {
    const { cwd } = await createProject({ 'migrator.config.ts': envAwareConfig });

    await expect(load(cwd, { nodeEnv: 'prod' })).resolves.toMatchObject({ env: 'prod' });
  });

  it('prefers the flag over NODE_ENV', async () => {
    const { cwd } = await createProject({ 'migrator.config.ts': envAwareConfig });

    await expect(load(cwd, { env: 'dev', nodeEnv: 'prod' })).resolves.toMatchObject({ env: 'dev' });
  });
});

describe('an alternative Config file', () => {
  it('is loaded from the path given instead of the default one', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': validConfig,
      'migrator.prod.ts': `export default { database: 'postgres://prod/db', transaction: 'all' };`,
    });

    await expect(load(cwd, { path: 'migrator.prod.ts' })).resolves.toMatchObject({
      database: 'postgres://prod/db',
      transaction: 'all',
    });
  });
});

describe('an invalid Config', () => {
  const rejectsField = async (source: string, field: string) => {
    const { cwd } = await createProject({ 'migrator.config.ts': source });

    await expect(load(cwd)).rejects.toMatchObject({ kind: 'config', field });
  };

  it('rejects a missing database', async () => {
    await rejectsField(`export default {};`, 'database');
  });

  it('rejects an empty database', async () => {
    await rejectsField(`export default { database: '   ' };`, 'database');
  });

  it('rejects an unknown transaction mode', async () => {
    await rejectsField(
      `export default { database: 'postgres://localhost/db', transaction: 'sometimes' };`,
      'transaction',
    );
  });

  it('rejects an unknown logger kind', async () => {
    await rejectsField(
      `export default { database: 'postgres://localhost/db', logger: 'yaml' };`,
      'logger',
    );
  });

  it('rejects an unknown storage', async () => {
    await rejectsField(
      `export default { database: 'postgres://localhost/db', storage: 'mongo' };`,
      'storage',
    );
  });

  it('rejects a Config with no default export', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `export const config = { database: 'postgres://localhost/db' };`,
    });

    await expect(load(cwd)).rejects.toMatchObject({ kind: 'config' });
  });

  it('reports the invalid field rather than trying to reach the database', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `
        export default {
          database: 'postgres://nobody@203.0.113.1:1/never',
          transaction: 'sometimes',
        };
      `,
    });

    const started = Date.now();

    await expect(load(cwd)).rejects.toMatchObject({ field: 'transaction' });

    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('a database given as a client factory', () => {
  it('is accepted instead of a connection string', async () => {
    const { cwd } = await createProject({
      'migrator.config.ts': `export default { database: () => ({ fake: 'client' }) };`,
    });

    await expect(load(cwd)).resolves.toMatchObject({ database: expect.any(Function) });
  });
});
