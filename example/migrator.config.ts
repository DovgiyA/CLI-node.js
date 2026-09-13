export default {
  database: process.env.DATABASE_URL ?? 'postgres://migrate:migrate@localhost:54329/migrate',
  env: 'dev',
};
