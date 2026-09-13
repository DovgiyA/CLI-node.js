/** Generated migrator.config.ts: connection string comes from the environment. */
export const configTemplate = (): string => `export default {
  database: process.env.DATABASE_URL ?? '',
};
`;

/** Example Migration that applies and reverts without edits. */
export const exampleMigrationTemplate = (): string => `import { defineMigration } from '@alex/migrate';

export default defineMigration({
  up: async ({ sql }) => {
    await sql.query('create table example_users (id integer primary key)');
  },
  down: async ({ sql }) => {
    await sql.query('drop table example_users');
  },
});
`;

export const suggestedScripts = {
  'migrate:up': 'migrate up',
  'migrate:down': 'migrate down',
  'migrate:status': 'migrate status',
  'migrate:create': 'migrate create --',
} as const;
