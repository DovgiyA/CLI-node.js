import { MigrationsError } from '../errors.js';
import { importTypeScript } from '../ts-runtime.js';
import type { LoadedMigration, MigrationDefinition, MigrationFile } from './types.js';

const isDefinition = (value: unknown): value is MigrationDefinition =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { up?: unknown }).up === 'function';

/**
 * Imports a Migration file and checks that it says what a Migration must say.
 * A file that fails this check is named in the error, so the user knows which
 * of their files to fix.
 */
export const loadMigration = async (file: MigrationFile): Promise<LoadedMigration> => {
  let exported: unknown;

  try {
    exported = (await importTypeScript(file.path)).default;
  } catch (cause) {
    throw new MigrationsError(
      `Не удалось загрузить миграцию ${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
      'Проверьте синтаксис файла и его импорты.',
      { cause },
    );
  }

  if (!isDefinition(exported)) {
    throw new MigrationsError(
      `Миграция ${file.name} не экспортирует по умолчанию объект с функцией up`,
      'Экспортируйте `export default defineMigration({ up, down })`.',
    );
  }

  return {
    name: file.name,
    path: file.path,
    checksum: file.checksum,
    up: exported.up,
    down: exported.down,
    transaction: exported.transaction !== false,
  };
};
