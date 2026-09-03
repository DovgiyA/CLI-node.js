/**
 * Every failure the CLI reports on purpose carries a hint: a concrete recovery
 * step, not a restatement of the problem. `kind` is the stable discriminator
 * that tests and JSON logs assert on, so error text stays free to change.
 */
import type { TransactionMode } from './config/types.js';

export abstract class MigrateError extends Error {
  abstract readonly kind: string;

  readonly hint: string;

  constructor(message: string, hint: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.hint = hint;
  }
}

export class ConfigNotFoundError extends MigrateError {
  readonly kind = 'config';

  constructor(searchedPath: string, options?: { cause?: unknown }) {
    super(
      `Файл конфига не найден: ${searchedPath}`,
      'Запустите `migrate init`, чтобы создать конфиг, или укажите другой путь через --config.',
      options,
    );
  }
}

/** The Config fields the loader can complain about, by name. */
export type ConfigField =
  | 'database'
  | 'migrationsDir'
  | 'seedersDir'
  | 'pattern'
  | 'storage'
  | 'transaction'
  | 'logger'
  | 'env';

/** A Config that was found and loaded, but says something unusable. */
export class ConfigInvalidError extends MigrateError {
  readonly kind = 'config';

  readonly field: ConfigField;

  constructor(field: ConfigField, problem: string, hint: string) {
    super(`Поле ${field} в конфиге ${problem}`, hint);
    this.field = field;
  }
}

/** A Config file that could not be imported or exports nothing usable. */
export class ConfigLoadError extends MigrateError {
  readonly kind = 'config';

  constructor(path: string, problem: string, hint: string, options?: { cause?: unknown }) {
    super(`Не удалось загрузить конфиг ${path}: ${problem}`, hint, options);
  }
}

/**
 * The database could not be reached or refused a statement the CLI needs.
 * Named to stay distinguishable from `pg`'s own `DatabaseError`.
 */
export class DatabaseAccessError extends MigrateError {
  readonly kind = 'database';
}

export type LockHolder = {
  pid: number;
  label: string;
  since?: Date;
};

/** Another Run is already holding the Lock for this database. */
export class LockBusyError extends MigrateError {
  readonly kind = 'lock';

  readonly holder: LockHolder;

  constructor(holder: LockHolder) {
    const hint =
      holder.since === undefined
        ? `Lock занят процессом ${holder.label}. Дождитесь завершения Run или завершите этот процесс.`
        : `Процесс ${holder.label} держит Lock с ${holder.since.toISOString()}. Дождитесь завершения Run или завершите этот процесс.`;

    super('Lock занят', hint);

    this.holder = holder;
  }
}

/** Checksum of an applied Migration no longer matches the Journal. */
export class DriftError extends MigrateError {
  readonly kind = 'drift';

  readonly migrations: readonly string[];

  constructor(migrations: readonly string[]) {
    super(
      `Drift: изменены применённые миграции: ${migrations.join(', ')}`,
      'Восстановите файлы в состояние на момент применения или создайте новые миграции с нужными изменениями.',
    );

    this.migrations = migrations;
  }
}

/** A Migration to revert has no file on disk. */
export class MissingMigrationError extends MigrateError {
  readonly kind = 'missing';

  readonly migration: string;

  constructor(migration: string) {
    super(
      `Миграция ${migration} Missing: файла нет, откатывать нечем`,
      'Восстановите файл миграции из git или удалите запись из журнала вручную, если откат больше не нужен.',
    );

    this.migration = migration;
  }
}

/** Down outside dev without a TTY and without `--force`. */
export class DownConfirmationRequiredError extends MigrateError {
  readonly kind = 'confirmation';

  constructor() {
    super(
      'Откат в не-dev окружении требует подтверждения',
      'Запустите с флагом --force или выполните команду в терминале и введите имя откатываемой миграции.',
    );
  }
}

/** The typed migration name did not match the one about to be reverted. */
export class DownConfirmationRejectedError extends MigrateError {
  readonly kind = 'confirmation';

  constructor() {
    super(
      'Подтверждение отменено',
      'Имя не совпало; откат не выполнен.',
    );
  }
}

type RunDirection = 'up' | 'down';

const buildEachHint = (
  migration: string,
  completed: readonly string[],
  doneVerb: string,
  journalVerb: string,
  recovery: string,
  rolledBack: boolean,
  direction: RunDirection,
): string => {
  const done =
    completed.length === 0
      ? ''
      : `Успешно ${doneVerb} и ${journalVerb}: ${completed.join(', ')}. `;

  const journalNote =
    direction === 'down'
      ? 'Запись в журнале для этой миграции не изменена. '
      : 'Запись в журнал для этой миграции не создана. ';

  const failed = rolledBack
    ? `Изменения миграции ${migration} откатаны. ${journalNote}`
    : `Изменения миграции ${migration} могли остаться частично (она выполнялась вне транзакции). ${journalNote}`;

  return `${done}${failed}${recovery}`;
};

const buildNoneHint = (
  migration: string,
  completed: readonly string[],
  doneVerb: string,
  journalVerb: string,
  direction: RunDirection,
  recovery: string,
): string => {
  const none =
    direction === 'down'
      ? 'Ни одна миграция не была откачена.'
      : 'Ни одна миграция не была применена.';
  const done =
    completed.length === 0
      ? none
      : `Успешно ${doneVerb} и ${journalVerb}: ${completed.join(', ')}.`;
  const partial = `Транзакций нет, поэтому изменения самой ${migration} могли остаться частично.`;

  return `${done} ${partial} ${recovery}`;
};

/**
 * A Migration threw while being applied or rolled back. The message names it,
 * and the hint says what the Journal now holds, because that is what decides
 * whether the user can simply fix the file and Run again.
 */
export class MigrationFailedError extends MigrateError {
  readonly kind = 'migration';

  readonly migration: string;

  constructor(
    migration: string,
    completed: readonly string[],
    options?: {
      cause?: unknown;
      direction?: RunDirection;
      transaction?: TransactionMode;
      rolledBack?: boolean;
    },
  ) {
    const direction = options?.direction ?? 'up';
    const mode = options?.transaction ?? 'each';
    const rolledBack = options?.rolledBack ?? mode === 'all';
    const doneVerb = direction === 'down' ? 'откачены' : 'применены';
    const journalVerb = direction === 'down' ? 'удалены из журнала' : 'записаны в журнал';
    const recovery =
      direction === 'down'
        ? 'Исправьте миграцию и запустите down снова.'
        : 'Исправьте миграцию и запустите up снова.';

    const hint =
      mode === 'all'
        ? `Транзакция откатана, журнал не изменён. ${recovery}`
        : mode === 'none'
          ? buildNoneHint(migration, completed, doneVerb, journalVerb, direction, recovery)
          : buildEachHint(migration, completed, doneVerb, journalVerb, recovery, rolledBack, direction);

    super(`Миграция ${migration} упала`, hint, options);

    this.migration = migration;
  }
}

/** Migration files on disk are unreadable, unusable or say the wrong thing. */
export class MigrationsError extends MigrateError {
  readonly kind = 'migrations';
}

/** Conflicting selection flags; the Run stops before opening a connection. */
export class SelectionConflictError extends MigrateError {
  readonly kind = 'selection';

  constructor(flags: readonly string[]) {
    super(
      `Флаги ${flags.join(', ')} нельзя указывать одновременно`,
      'Выберите один способ: --step N, --to <имя> или, для полного отката, --all.',
    );
  }
}

/** `--to` named a Migration that does not exist in the expected set. */
export class UnknownMigrationError extends MigrateError {
  readonly kind = 'selection';

  readonly migration: string;

  constructor(migration: string, where: 'known' | 'executed') {
    const hint =
      where === 'known'
        ? 'Проверьте имя файла миграции: оно должно совпадать с именем без расширения.'
        : 'Эта миграция ещё не применена; откатить её нельзя. Запустите `migrate status`, чтобы увидеть, что применено.';

    super(`Миграция ${migration} не найдена`, hint);

    this.migration = migration;
  }
}

export class NotImplementedError extends MigrateError {
  readonly kind = 'not-implemented';

  constructor(command: string) {
    super(
      `Команда ${command} пока не реализована`,
      'Эта версия CLI ещё не умеет её выполнять. Обновите пакет до версии, в которой она заявлена.',
    );
  }
}

export const isMigrateError = (error: unknown): error is MigrateError => error instanceof MigrateError;
