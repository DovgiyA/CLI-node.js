/** Contents of a freshly generated Migration file. */
export const migrationTemplate = (): string => `import { defineMigration } from '@alex/migrate';

export default defineMigration({
  // transaction: false,
  up: async ({ sql }) => {
    await sql.query('select 1');
  },
  down: async ({ sql }) => {
    await sql.query('select 1');
  },
});
`;
