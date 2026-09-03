import { defineMigration } from '@alex/migrate';

export default defineMigration({
  up: async ({ sql }) => {
    await sql.query('create table widgets (id integer primary key, name text not null)');
  },
  down: async ({ sql }) => {
    await sql.query('drop table widgets');
  },
});
