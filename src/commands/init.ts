import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  configPath,
  exampleMigrationPath,
  migrationsDir,
  seedersDir,
} from '../init/artifacts.js';
import {
  configTemplate,
  exampleMigrationTemplate,
  suggestedScripts,
} from '../init/templates.js';
import type { InitResult } from '../reporter.js';

export type InitOptions = {
  cwd: string;
};

type InitAction = InitResult['entries'][number]['action'];

const isExists = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: string }).code === 'EEXIST';

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const ensureDirectory = async (absolutePath: string): Promise<InitAction> => {
  if (await exists(absolutePath)) {
    return 'skipped';
  }

  await mkdir(absolutePath, { recursive: true });
  return 'created';
};

const ensureFile = async (
  absolutePath: string,
  content: string,
): Promise<InitAction> => {
  try {
    await writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
    return 'created';
  } catch (cause) {
    if (isExists(cause)) {
      return 'skipped';
    }

    throw cause;
  }
};

/**
 * Scaffolds a consumer project without touching files the user owns. Every
 * artifact is created once; a second Run prints `skipped` and exits cleanly.
 */
export const init = async (options: InitOptions): Promise<InitResult> => {
  const { cwd } = options;
  const entries: InitResult['entries'] = [];

  const record = (path: string, action: InitAction): void => {
    entries.push({ path, action });
  };

  record(configPath, await ensureFile(join(cwd, configPath), configTemplate()));
  record(migrationsDir, await ensureDirectory(join(cwd, migrationsDir)));
  record(
    exampleMigrationPath,
    await ensureFile(join(cwd, exampleMigrationPath), exampleMigrationTemplate()),
  );
  record(seedersDir, await ensureDirectory(join(cwd, seedersDir)));

  return {
    entries,
    scripts: { ...suggestedScripts },
  };
};
