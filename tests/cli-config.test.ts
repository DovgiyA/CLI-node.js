import { describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { createProject, validConfig } from './support/project.js';

describe('commands that need a Config', () => {
  /**
   * Proof that loading succeeded, without leaning on any command being a stub:
   * the project has a valid Config and no Migration folder, so the next
   * failure after loading is about the folder.
   */
  it('get past config loading in a configured project', async () => {
    const { io } = await createProject({ 'migrator.config.ts': validConfig });

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stderrLines()).toEqual([expect.objectContaining({ kind: 'migrations' })]);
  });

  it('report the offending field when the Config is invalid', async () => {
    const { io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://localhost/db', transaction: 'sometimes' };`,
    });

    const code = await run(['up', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({ kind: 'config', hint: expect.stringContaining('all, each, none') }),
    ]);
  });

  it('take the Config from the path given by --config', async () => {
    const { io } = await createProject({
      'migrator.config.ts': validConfig,
      'migrator.prod.ts': `export default { database: '' };`,
    });

    const code = await run(['up', '--config', 'migrator.prod.ts', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({ kind: 'config', hint: expect.stringContaining('postgres://') }),
    ]);
  });

  it('pass the environment named by --env to a Config function', async () => {
    const { io } = await createProject({
      'migrator.config.ts': `
        export default (env) => ({ database: env === 'prod' ? '' : 'postgres://localhost/db' });
      `,
    });

    expect(await run(['up', '--env', 'prod', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines()).toEqual([expect.objectContaining({ kind: 'config' })]);
  });

  it('fall back to NODE_ENV when --env is absent', async () => {
    const { io } = await createProject(
      {
        'migrator.config.ts': `
          export default (env) => ({ database: env === 'prod' ? '' : 'postgres://localhost/db' });
        `,
      },
      { NODE_ENV: 'prod' },
    );

    expect(await run(['up', '--logger', 'json'], io)).toBe(1);
    expect(io.stderrLines()).toEqual([expect.objectContaining({ kind: 'config' })]);
  });
});

describe('the logger named by the Config', () => {
  const jsonLoggerConfig = `export default { database: 'postgres://localhost/db', logger: 'json' };`;

  it('is used when no flag is given', async () => {
    const { io } = await createProject({ 'migrator.config.ts': jsonLoggerConfig });

    await run(['up'], io);

    expect(io.stderrLines()).toEqual([expect.objectContaining({ kind: 'migrations' })]);
  });

  it('loses to an explicit --logger flag', async () => {
    const { io } = await createProject({ 'migrator.config.ts': jsonLoggerConfig });

    await run(['up', '--logger', 'pretty'], io);

    expect(io.stderrText()).toContain('Папки с миграциями нет');
    expect(() => io.stderrLines()).toThrow();
  });
});
