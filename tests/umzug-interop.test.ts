import { Umzug, memoryStorage } from 'umzug';
import { describe, expect, it } from 'vitest';

/**
 * Umzug 3.8.3 ships CommonJS only: no `exports` map, no `type: module`. This
 * package is ESM-only, so named imports crossing that boundary are a real
 * risk, and every later ticket depends on them working.
 */
describe('umzug is usable from ESM', () => {
  it('resolves named imports and drives a run against in-memory storage', async () => {
    const applied: string[] = [];
    const umzug = new Umzug({
      migrations: [
        { name: '20260101T000000-first', up: async () => void applied.push('first'), down: async () => {} },
      ],
      storage: memoryStorage(),
      logger: undefined,
    });

    expect(await umzug.pending()).toEqual([{ name: '20260101T000000-first' }]);

    await umzug.up();

    expect(applied).toEqual(['first']);
    expect(await umzug.executed()).toEqual([{ name: '20260101T000000-first' }]);
  });
});
