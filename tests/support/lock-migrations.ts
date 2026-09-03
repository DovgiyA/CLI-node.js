export const slowUpMigration = {
  '20260101T000000-slow.ts': `
    export default {
      up: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      },
    };
  `,
};

export const slowDownMigration = {
  '20260101T000000-slow.ts': `
    export default {
      up: async ({ sql }) => {
        await sql.query('select 1');
      },
      down: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      },
    };
  `,
};

export const failingUpMigration = {
  '20260101T000000-fail.ts': `
    export default {
      up: async () => {
        throw new Error('boom');
      },
    };
  `,
};
