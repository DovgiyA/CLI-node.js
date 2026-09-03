import type { Io } from './io.js';
import type { Namespace } from './journal/journal.js';
import type { LoggerKind } from './logger.js';

/**
 * Command results go to stdout while logs go to stderr, so
 * `migrate status --logger json | jq` is a working pipeline.
 */
export type Reporter = {
  status: (result: StatusResult) => void;
  applied: (result: AppliedResult) => void;
  reverted: (result: RevertedResult) => void;
  created: (result: CreatedResult) => void;
  init: (result: InitResult) => void;
};

export type InitEntry = {
  path: string;
  action: 'created' | 'skipped';
};

export type InitResult = {
  entries: InitEntry[];
  scripts: Record<string, string>;
};

export type CreatedResult = {
  namespace: Namespace;
  path: string;
  name: string;
};

export type MigrationState = 'executed' | 'pending' | 'missing';

export type StatusEntry = {
  name: string;
  state: MigrationState;
  appliedAt: string | null;
  /** Truncated: the machine-readable output carries it, the table does not. */
  checksum: string;
};

export type StatusResult = {
  namespace: Namespace;
  migrations: StatusEntry[];
};

/** What a Run applied, in the order it applied them. */
export type AppliedResult = {
  namespace: Namespace;
  applied: string[];
};

/** What a Run reverted, in the order it reverted them. */
export type RevertedResult = {
  namespace: Namespace;
  reverted: string[];
  /** Why nothing was reverted when `reverted` is empty. */
  idle?: 'nothing-executed' | 'already-at-target';
};

const columns = ['name', 'appliedAt', 'state'] as const;

const renderTable = (entries: StatusEntry[]): string => {
  const rows = entries.map((entry) => [entry.name, entry.appliedAt ?? '—', entry.state]);
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );

  const line = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd();

  return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n',
  );
};

export const createReporter = (kind: LoggerKind, io: Io): Reporter => ({
  applied: (result) => {
    if (kind === 'json') {
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (result.applied.length === 0) {
      io.stdout.write('Применять нечего: все миграции уже применены.\n');
      return;
    }

    io.stdout.write(
      `${['Применены:', ...result.applied.map((name) => `  ${name}`)].join('\n')}\n`,
    );
  },

  reverted: (result) => {
    if (kind === 'json') {
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (result.reverted.length === 0) {
      const message =
        result.idle === 'already-at-target'
          ? 'Откатывать нечего: названная миграция уже последняя применённая.'
          : 'Откатывать нечего: ни одна миграция не применена.';

      io.stdout.write(`${message}\n`);
      return;
    }

    io.stdout.write(
      `${['Откачены:', ...result.reverted.map((name) => `  ${name}`)].join('\n')}\n`,
    );
  },

  status: (result) => {
    if (kind === 'json') {
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    // Even with nothing to show, the table is printed: the header proves the
    // Journal was read, and an empty body says what it holds.
    io.stdout.write(`${renderTable(result.migrations)}\n`);
  },

  created: (result) => {
    if (kind === 'json') {
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    io.stdout.write(`Создан: ${result.path}\n`);
  },

  init: (result) => {
    if (kind === 'json') {
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    const lines = [
      ...result.entries.map((entry) => `${entry.action} ${entry.path}`),
      '',
      'Добавьте в package.json:',
      ...Object.entries(result.scripts).map(([name, command]) => `  "${name}": "${command}"`),
    ];

    io.stdout.write(`${lines.join('\n')}\n`);
  },
});
