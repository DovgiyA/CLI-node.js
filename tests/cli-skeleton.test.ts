import { describe, expect, it } from 'vitest';

import { ConfigNotFoundError } from '../src/errors.js';
import { run } from '../src/run.js';
import { createTestIo, inEmptyProject } from './support/io.js';

describe('migrate status without a config', () => {
  it('fails with exit code 1 and names the config file it looked for', async () => {
    const io = await inEmptyProject();

    const code = await run(['status'], io);

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('migrator.config.ts');
  });

  it('writes nothing to stdout, so a failed run pipes cleanly', async () => {
    const io = await inEmptyProject();

    await run(['status'], io);

    expect(io.stdoutText()).toBe('');
  });

  it('reports the failure as one parseable log line with a recovery hint under the json logger', async () => {
    const io = await inEmptyProject();

    const code = await run(['status', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stderrLines()).toEqual([
      expect.objectContaining({
        level: 50,
        kind: 'config',
        hint: expect.stringContaining('migrate init'),
      }),
    ]);
  });
});

describe('exit codes and stream discipline', () => {
  it('prints help to stdout and succeeds', async () => {
    const io = createTestIo();

    const code = await run(['--help'], io);

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('migrate');
    expect(io.stderrText()).toBe('');
  });

  it('prints the version to stdout and succeeds', async () => {
    const io = createTestIo();

    const code = await run(['--version'], io);

    expect(code).toBe(0);
    expect(io.stdoutText().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects an unknown option with exit code 1 and an empty stdout', async () => {
    const io = createTestIo();

    const code = await run(['status', '--nonsense'], io);

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
  });

  it('rejects an unsupported logger kind', async () => {
    const io = createTestIo();

    const code = await run(['status', '--logger', 'yaml'], io);

    expect(code).toBe(1);
  });
});

describe('failure vocabulary', () => {
  it('names a missing config with a dedicated error class', async () => {
    const error = new ConfigNotFoundError('/tmp/nowhere/migrator.config.ts');

    expect(error.kind).toBe('config');
    expect(error.hint).not.toBe('');
    expect(error.message).toContain('/tmp/nowhere/migrator.config.ts');
  });
});
