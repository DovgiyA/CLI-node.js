import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { glob } from 'tinyglobby';

import { MigrationsError } from '../errors.js';
import type { MigrationFile } from './types.js';

export type DiscoverOptions = {
  dir: string;
  pattern: string;
};

/** Ensures the migrations folder exists before reading or writing files. */
export const assertMigrationsDirectory = async (dir: string): Promise<void> => {
  let isDirectory: boolean;

  try {
    isDirectory = (await stat(dir)).isDirectory();
  } catch (cause) {
    throw new MigrationsError(
      `Папки с миграциями нет: ${dir}`,
      'Создайте её или поправьте migrationsDir в конфиге; `migrate init` сделает это за вас.',
      { cause },
    );
  }

  if (!isDirectory) {
    throw new MigrationsError(
      `Путь к миграциям указывает не на папку: ${dir}`,
      'Поправьте migrationsDir в конфиге: он должен указывать на папку, а не на файл.',
    );
  }
};

const nameOf = (path: string): string => basename(path, extname(path));

/**
 * The one ordering rule: names sort, and the timestamp prefix is what makes
 * that order meaningful. Everything that presents Migration in order goes
 * through here, so the rule lives in a single place.
 */
export const compareByName = (left: { name: string }, right: { name: string }): number => {
  if (left.name === right.name) {
    return 0;
  }

  return left.name < right.name ? -1 : 1;
};

/**
 * Finds Migration files and fingerprints them. Ordering is by name, which is
 * why the timestamp prefix in the filename is the ordering contract: any file
 * that breaks the naming scheme silently runs out of order.
 */
export const discoverMigrations = async (options: DiscoverOptions): Promise<MigrationFile[]> => {
  const { dir, pattern } = options;

  await assertMigrationsDirectory(dir);

  const paths = await glob(pattern, { cwd: dir, absolute: false, onlyFiles: true });

  const files = await Promise.all(
    paths.map(async (relative): Promise<MigrationFile> => {
      const path = join(dir, relative);
      const contents = await readFile(path);

      return {
        name: nameOf(relative),
        path,
        checksum: createHash('sha256').update(contents).digest('hex'),
      };
    }),
  );

  return files.sort(compareByName);
};
