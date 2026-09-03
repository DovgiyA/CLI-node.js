import { isMigrateError } from './errors.js';
import type { Io } from './io.js';
import { createLogger, type LoggerKind } from './logger.js';

/**
 * The single place a failure turns into output. Deliberate failures report
 * their kind and recovery hint; anything else is reported as unexpected.
 */
export const reportFailure = (error: unknown, loggerKind: LoggerKind, io: Io): void => {
  const logger = createLogger(loggerKind, io);

  if (isMigrateError(error)) {
    logger.error({ kind: error.kind, hint: error.hint }, error.message);
    return;
  }

  logger.error({ kind: 'unexpected' }, error instanceof Error ? error.message : String(error));
};
