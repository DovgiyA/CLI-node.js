import type { Config } from './config/types.js';
import type { Namespace } from './journal/journal.js';

/**
 * A Namespace is a sequence with its own folder and its own slice of the
 * Journal, so both sides must be derived from it.
 */
export const directoryOf = (config: Config, namespace: Namespace): string => {
  if (namespace === 'migrations') {
    return config.migrationsDir;
  }

  return config.seedersDir;
};
