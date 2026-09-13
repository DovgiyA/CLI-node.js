import { access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { ConfigNotFoundError } from '../errors.js';

export const defaultConfigFilename = 'migrator.config.ts';

/**
 * Resolves the config path and proves it exists. Loading and validating it is
 * a separate concern; this only makes the "there is no config" failure precise.
 */
export const locateConfig = async (cwd: string, explicitPath?: string): Promise<string> => {
  const candidate = explicitPath ?? defaultConfigFilename;
  const path = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);

  try {
    await access(path);
  } catch (cause) {
    throw new ConfigNotFoundError(path, { cause });
  }

  return path;
};
