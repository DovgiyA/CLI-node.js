import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Io } from '../../src/io.js';

export type TestIo = Io & {
  stdoutText: () => string;
  stderrText: () => string;
  stderrLines: () => unknown[];
};

export const createTestIo = (overrides: Partial<Io> = {}): TestIo => {
  const out: string[] = [];
  const err: string[] = [];

  return {
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? {},
    isTty: overrides.isTty ?? false,
    stdout: { write: (chunk: string) => void out.push(chunk) },
    stderr: { write: (chunk: string) => void err.push(chunk) },
    stdoutText: () => out.join(''),
    stderrText: () => err.join(''),
    stderrLines: () =>
      err
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as unknown),
  };
};

export const emptyProjectDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'migrate-test-'));

/** A throwaway project directory with no config, plus an Io pointed at it. */
export const inEmptyProject = async (): Promise<TestIo> =>
  createTestIo({ cwd: await emptyProjectDir() });
