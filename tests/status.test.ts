import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { isPostgresReachable, useTestSchemas, type TestSchema } from './support/postgres.js';
import { createProject, projectOn } from './support/project.js';

const reachable = await isPostgresReachable();

const freshSchema = useTestSchemas(afterEach);

describe.skipIf(!reachable)('migrate status against an empty database', () => {
  it('succeeds and prints a table with a header and no rows', async () => {
    const { io } = await projectOn(await freshSchema());

    const code = await run(['status'], io);

    expect(code).toBe(0);

    const lines = io.stdoutText().trimEnd().split('\n');

    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('appliedAt');
    expect(lines[0]).toContain('state');
    expect(lines).toHaveLength(2);
  });

  it('prints one machine-readable structure under the json logger', async () => {
    const { io } = await projectOn(await freshSchema());

    const code = await run(['status', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({ namespace: 'migrations', migrations: [] });
  });

  it('creates the Journal so a second run works the same', async () => {
    const schema = await freshSchema();
    const { io: first } = await projectOn(schema);
    const { io: second } = await projectOn(schema);

    expect(await run(['status'], first)).toBe(0);
    expect(await run(['status'], second)).toBe(0);
  });
});

const schemaWithOneApplied = async () => {
  const schema = await freshSchema();
  const { io } = await projectOn(schema, {
    '20260101T000000-add-users-table.ts': 'export default { up: async () => {} };',
  });

  await run(['up'], io);

  return schema;
};

describe.skipIf(!reachable)('migrate status with records in the Journal', () => {
  it('lists them as executed with the time they were applied', async () => {
    const schema = await schemaWithOneApplied();

    const { io: after } = await projectOn(schema, {
      '20260101T000000-add-users-table.ts': 'export default { up: async () => {} };',
    });
    const code = await run(['status', '--logger', 'json'], after);

    expect(code).toBe(0);
    expect(JSON.parse(after.stdoutText())).toEqual({
      namespace: 'migrations',
      migrations: [
        {
          name: '20260101T000000-add-users-table',
          state: 'executed',
          appliedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          checksum: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
      ],
    });
  });

  it('shows them in a readable table when the logger is pretty', async () => {
    const schema = await schemaWithOneApplied();

    const { io: after } = await projectOn(schema, {
      '20260101T000000-add-users-table.ts': 'export default { up: async () => {} };',
    });
    await run(['status'], after);

    const output = after.stdoutText();

    expect(output).toContain('20260101T000000-add-users-table');
    expect(output).toContain('executed');
    expect(output).toContain('name');
  });
});

describe.skipIf(!reachable)('migrate status with Migration files on disk', () => {
  const twoMigrations = {
    '20260101T000000-add-users-table.ts': 'export default { up: async () => {} };',
    '20260102T000000-add-orders-table.ts': 'export default { up: async () => {} };',
  };

  it('lists them as pending, in timestamp order, with no time of application', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, twoMigrations);

    const code = await run(['status', '--logger', 'json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({
      namespace: 'migrations',
      migrations: [
        {
          name: '20260101T000000-add-users-table',
          state: 'pending',
          appliedAt: null,
          checksum: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
        {
          name: '20260102T000000-add-orders-table',
          state: 'pending',
          appliedAt: null,
          checksum: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
      ],
    });
  });

  it('shows a file already in the Journal as executed and the rest as pending', async () => {
    const schema = await freshSchema();
    const { io: first } = await projectOn(schema, twoMigrations);
    await run(['status'], first);

    await schema.query(
      `insert into __migrations (namespace, name, checksum) values ('migrations', $1, 'abc')`,
      ['20260101T000000-add-users-table'],
    );

    const { io } = await projectOn(schema, twoMigrations);
    await run(['status', '--logger', 'json'], io);

    const result = JSON.parse(io.stdoutText()) as {
      migrations: { name: string; state: string }[];
    };

    expect(result.migrations.map((entry) => [entry.name, entry.state])).toEqual([
      ['20260101T000000-add-users-table', 'executed'],
      ['20260102T000000-add-orders-table', 'pending'],
    ]);
  });

  it('reads TypeScript and JavaScript files alike', async () => {
    const schema = await freshSchema();
    const { io } = await projectOn(schema, {
      '20260101T000000-typescript.ts': 'export default { up: async (): Promise<void> => {} };',
      '20260102T000000-javascript.js': 'export default { up: async () => {} };',
    });

    await run(['status', '--logger', 'json'], io);

    const result = JSON.parse(io.stdoutText()) as { migrations: { name: string }[] };

    expect(result.migrations.map((entry) => entry.name)).toEqual([
      '20260101T000000-typescript',
      '20260102T000000-javascript',
    ]);
  });
});

describe.skipIf(!reachable)('migrate status against an unreachable database', () => {
  it('fails with exit code 1 and an empty stdout', async () => {
    const { cwd, io } = await createProject({
      'migrator.config.ts': `export default { database: 'postgres://nobody:nobody@127.0.0.1:1/none' };`,
    });
    await mkdir(join(cwd, 'migrations'));

    const code = await run(['status', '--logger', 'json'], io);

    expect(code).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(io.stderrLines()).toEqual([expect.objectContaining({ kind: 'database' })]);
  });
});
