import { defineMigration } from '@alex/migrate';

export default defineMigration({
  up: async ({ sql }) => {
    await sql.query("insert into widgets (id, name) values (1, 'demo')");
  },
  down: async ({ sql }) => {
    await sql.query('delete from widgets where id = 1');
  },
});
