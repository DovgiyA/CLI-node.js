import { Writable } from 'node:stream';

import { pino, type Logger } from 'pino';
import pretty from 'pino-pretty';

import type { Io } from './io.js';

export type LoggerKind = 'pretty' | 'json';

export const loggerKinds: readonly LoggerKind[] = ['pretty', 'json'];

export const isLoggerKind = (value: string): value is LoggerKind =>
  (loggerKinds as readonly string[]).includes(value);

/**
 * Logs always go to stderr, so stdout stays a clean channel for command
 * results and `migrate status --logger json | jq` works.
 */
export const createLogger = (kind: LoggerKind, io: Io): Logger => {
  // pino-pretty pipes into its destination, so it needs a real stream rather
  // than the bare `write` object the Io contract promises.
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      io.stderr.write(chunk.toString());
      callback();
    },
  });

  if (kind === 'json') {
    return pino({ base: null }, destination);
  }

  return pino(
    { base: null },
    pretty({ colorize: io.isTty, destination, sync: true, ignore: 'time' }),
  );
};
