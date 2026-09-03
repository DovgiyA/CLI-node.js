import { asDatabaseAccessError, type Sql } from '../database.js';

export type Namespace = 'migrations' | 'seeders';

export const journalTable = '__migrations';

export type JournalRecord = {
  name: string;
  appliedAt: Date;
  checksum: string;
};

export type OpenJournalOptions = {
  sql: Sql;
  namespace: Namespace;
};

/**
 * The Journal: the only source of truth about which Migration is Executed.
 *
 * Speaks the glossary, not umzug: `record` and `forget` describe what happens
 * to the fact that a Migration is Executed, and the Checksum is an explicit
 * argument because umzug's shared context cannot carry a per-Migration value.
 * Adapting to umzug's storage contract is the Runner's job. `records` exists
 * because that contract can only carry names, while `status` and Drift
 * detection need the time of application and the Checksum too. See ADR-0001.
 */
export type Journal = {
  record: (entry: { name: string; checksum: string }) => Promise<void>;
  forget: (entry: { name: string }) => Promise<void>;
  executed: () => Promise<string[]>;
  records: () => Promise<JournalRecord[]>;
};

/**
 * Makes sure the Journal table exists and hands back a Journal over the given
 * connection. The connection stays the caller's to close.
 */
export const openJournal = async (options: OpenJournalOptions): Promise<Journal> => {
  const { sql, namespace } = options;

  const query = async <T extends Record<string, unknown>>(
    statement: string,
    values: unknown[] = [],
  ): Promise<T[]> => {
    try {
      const result = await sql.query<T>(statement, values);
      return result.rows;
    } catch (cause) {
      throw asDatabaseAccessError(cause);
    }
  };

  const readRecords = async (): Promise<JournalRecord[]> => {
    const rows = await query<{ name: string; applied_at: Date; checksum: string }>(
      `select name, applied_at, checksum from ${journalTable} where namespace = $1 order by name`,
      [namespace],
    );

    return rows.map((row) => ({
      name: row.name,
      appliedAt: row.applied_at,
      checksum: row.checksum,
    }));
  };

  await query(`
    create table if not exists ${journalTable} (
      namespace text not null,
      name text not null,
      applied_at timestamptz not null default now(),
      checksum text not null default '',
      primary key (namespace, name)
    )
  `);

  return {
    // A plain insert on purpose: re-logging an already Executed Migration is a
    // conflict no ticket has defined yet, and silently rewriting `applied_at`
    // would destroy the evidence Drift detection needs.
    record: async ({ name, checksum }) => {
      await query(`insert into ${journalTable} (namespace, name, checksum) values ($1, $2, $3)`, [
        namespace,
        name,
        checksum,
      ]);
    },

    forget: async ({ name }) => {
      await query(`delete from ${journalTable} where namespace = $1 and name = $2`, [
        namespace,
        name,
      ]);
    },

    executed: async () => (await readRecords()).map((record) => record.name),

    records: readRecords,
  };
};
