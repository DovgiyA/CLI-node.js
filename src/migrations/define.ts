import type { MigrationDefinition } from './types.js';

/**
 * Identity at runtime; exists so a Migration file gets type inference on its
 * context and a place to declare `transaction: false`.
 */
export const defineMigration = (definition: MigrationDefinition): MigrationDefinition =>
  definition;
