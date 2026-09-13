import { describe, expect, it } from 'vitest';

import { SelectionConflictError } from '../src/errors.js';
import { parseDownSelection, parseUpSelection } from '../src/selection/parse.js';
import {
  migrationsToRevertForDownTo,
  requireUpToTarget,
  upToAlreadyReached,
} from '../src/selection/resolve.js';

describe('conflicting selection flags', () => {
  it('reject up when --to and --step are both given', () => {
    expect(() => parseUpSelection({ step: 2, to: '20260101T000000-first' })).toThrow(
      SelectionConflictError,
    );
  });

  it('reject down when --to and --step are both given', () => {
    expect(() => parseDownSelection({ step: 2, to: '20260101T000000-first' })).toThrow(
      SelectionConflictError,
    );
  });

  it('reject down when --all is combined with --step', () => {
    expect(() => parseDownSelection({ all: true, step: 1 })).toThrow(SelectionConflictError);
  });
});

describe('down --to as exclusive', () => {
  it('keeps the named Migration and reverts only what came after it, newest first', () => {
    expect(
      migrationsToRevertForDownTo(
        ['20260101T000000-a', '20260102T000000-b', '20260103T000000-c'],
        '20260102T000000-b',
      ),
    ).toEqual(['20260103T000000-c']);
  });

  it('returns nothing when the named Migration is already the last one applied', () => {
    expect(
      migrationsToRevertForDownTo(['20260101T000000-a', '20260102T000000-b'], '20260102T000000-b'),
    ).toEqual([]);
  });
});

describe('up --to when the target is already reached', () => {
  const known = ['20260101T000000-a', '20260102T000000-b', '20260103T000000-c'];

  it('needs no Run when the target is already the last Executed Migration', () => {
    expect(
      upToAlreadyReached(known, ['20260101T000000-a', '20260102T000000-b'], [], '20260102T000000-b'),
    ).toBe(true);
  });

  it('still needs a Run when Pending Migration remain before the target', () => {
    expect(
      upToAlreadyReached(
        known,
        ['20260101T000000-a'],
        ['20260102T000000-b', '20260103T000000-c'],
        '20260102T000000-b',
      ),
    ).toBe(false);
  });
});

describe('unknown --to targets', () => {
  it('fail before a Run when the name is not among Migration files', () => {
    expect(() => requireUpToTarget(['20260101T000000-a'], '20260199T000000-nope')).toThrow(
      expect.objectContaining({ kind: 'selection', migration: '20260199T000000-nope' }),
    );
  });

  it('fail when down --to names a Migration that is not Executed', () => {
    expect(() =>
      migrationsToRevertForDownTo(['20260101T000000-a'], '20260102T000000-b'),
    ).toThrow(expect.objectContaining({ kind: 'selection', migration: '20260102T000000-b' }));
  });
});
