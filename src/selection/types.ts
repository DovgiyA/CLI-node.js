/** How many Pending Migration to apply, or up to which one. */
export type UpSelection =
  | { kind: 'all' }
  | { kind: 'step'; step: number }
  | { kind: 'to'; name: string };

/** How many Executed Migration to revert, down to which one, or all. */
export type DownSelection =
  | { kind: 'step'; step: number }
  | { kind: 'to'; name: string }
  | { kind: 'all' };
