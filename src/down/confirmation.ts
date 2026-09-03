import type { Io } from '../io.js';
import { DownConfirmationRejectedError, DownConfirmationRequiredError } from '../errors.js';
import type { Config } from '../config/types.js';

/** Confirms a dangerous down outside dev, unless `--force` or there is nothing to revert. */
export const requireDownConfirmation = async (
  io: Io,
  config: Config,
  force: boolean,
  migration: string | undefined,
): Promise<void> => {
  if (config.env === 'dev' || force || migration === undefined) {
    return;
  }

  if (!io.isTty) {
    throw new DownConfirmationRequiredError();
  }

  if (io.readLine === undefined) {
    throw new DownConfirmationRequiredError();
  }

  const answer = await io.readLine(
    `Откат в окружении ${config.env}. Введите имя откатываемой миграции (${migration}): `,
  );

  if (answer.trim() !== migration) {
    throw new DownConfirmationRejectedError();
  }
};
