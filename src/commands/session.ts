import { connectionStringOf } from '../config/connection.js';
import type { Config } from '../config/types.js';
import { withConnection, type Sql } from '../database.js';
import { withAdvisoryLock } from '../lock/lock.js';
import { openJournal, type Journal, type Namespace } from '../journal/journal.js';
import { discoverMigrations } from '../migrations/discover.js';
import type { MigrationFile } from '../migrations/types.js';
import { directoryOf } from '../namespaces.js';

export type SessionOptions = {
  config: Config;
  namespace: Namespace;
};

export type Session = {
  journal: Journal;
  sql: Sql;
};

/** The Migration files of a Namespace, found the way its Config describes. */
export const filesOf = (options: SessionOptions): Promise<MigrationFile[]> =>
  discoverMigrations({
    dir: directoryOf(options.config, options.namespace),
    pattern: options.config.pattern,
  });

/**
 * A connection and the Journal on it. Both the Journal and a Migration share
 * this connection — ADR-0001. Read-only commands such as `status` use this
 * without taking the Lock; `up` and `down` go through {@link inLockedSession}.
 */
export const inSession = async <T>(
  options: SessionOptions,
  use: (session: Session) => Promise<T>,
): Promise<T> =>
  withConnection(connectionStringOf(options.config), async (sql) =>
    use({ journal: await openJournal({ sql, namespace: options.namespace }), sql }),
  );

/**
 * Like {@link inSession}, but takes the Lock first on a separate connection so
 * a `ROLLBACK` inside the Run cannot release it prematurely — ADR-0002.
 */
export const inLockedSession = async <T>(
  options: SessionOptions,
  use: (session: Session) => Promise<T>,
): Promise<T> =>
  withAdvisoryLock(connectionStringOf(options.config), () => inSession(options, use));
