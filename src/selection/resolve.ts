import { UnknownMigrationError } from '../errors.js';

/**
 * For `down --to`, ADR-0003: revert everything after the named Migration, in
 * reverse application order. The named Migration itself stays Executed.
 */
export const migrationsToRevertForDownTo = (
  executedInOrder: readonly string[],
  targetName: string,
): string[] => {
  const index = executedInOrder.indexOf(targetName);

  if (index === -1) {
    throw new UnknownMigrationError(targetName, 'executed');
  }

  return executedInOrder.slice(index + 1).reverse();
};

/** A `--to` on up must name a Migration file that exists on disk. */
export const requireUpToTarget = (knownNames: readonly string[], targetName: string): void => {
  if (!knownNames.some((name) => name === targetName)) {
    throw new UnknownMigrationError(targetName, 'known');
  }
};

/**
 * When the target is already Executed and nothing Pending comes before the
 * next one in file order, umzug would throw; treat that as «already there».
 */
export const upToAlreadyReached = (
  knownNames: readonly string[],
  executedNames: readonly string[],
  pendingNames: readonly string[],
  targetName: string,
): boolean => {
  const executed = new Set(executedNames);
  const pending = new Set(pendingNames);
  const ordered = [...knownNames].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const targetIndex = ordered.indexOf(targetName);

  if (targetIndex === -1) {
    return false;
  }

  if (pending.has(targetName)) {
    return false;
  }

  return ordered.slice(0, targetIndex + 1).every((name) => executed.has(name));
};
