import { SelectionConflictError } from '../errors.js';
import type { DownSelection, UpSelection } from './types.js';

export type UpFlags = {
  step?: number | undefined;
  to?: string | undefined;
};

export type DownFlags = {
  step?: number | undefined;
  to?: string | undefined;
  all?: boolean | undefined;
};

const rejectIfMultiple = (present: readonly (readonly [string, boolean])[]): void => {
  const active = present.filter(([, on]) => on).map(([name]) => name);

  if (active.length > 1) {
    throw new SelectionConflictError(active);
  }
};

/** Turns CLI flags into an UpSelection. Conflicting flags fail before any I/O. */
export const parseUpSelection = (flags: UpFlags): UpSelection => {
  rejectIfMultiple([
    ['--step', flags.step !== undefined],
    ['--to', flags.to !== undefined],
  ]);

  if (flags.to !== undefined) {
    return { kind: 'to', name: flags.to };
  }

  if (flags.step !== undefined) {
    return { kind: 'step', step: flags.step };
  }

  return { kind: 'all' };
};

/**
 * Turns CLI flags into a DownSelection. With no flags the default is one
 * step — the same as calling `down` with no arguments at all.
 */
export const parseDownSelection = (flags: DownFlags): DownSelection => {
  rejectIfMultiple([
    ['--step', flags.step !== undefined],
    ['--to', flags.to !== undefined],
    ['--all', flags.all === true],
  ]);

  if (flags.all === true) {
    return { kind: 'all' };
  }

  if (flags.to !== undefined) {
    return { kind: 'to', name: flags.to };
  }

  if (flags.step !== undefined) {
    return { kind: 'step', step: flags.step };
  }

  return { kind: 'step', step: 1 };
};
