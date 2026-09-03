import { writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

import type { Config } from '../config/types.js';
import { MigrationsError } from '../errors.js';
import type { Namespace } from '../journal/journal.js';
import { assertMigrationsDirectory } from '../migrations/discover.js';
import { migrationFileName, slugify } from '../migrations/slug.js';
import { migrationTemplate } from '../migrations/template.js';
import { directoryOf } from '../namespaces.js';
import type { CreatedResult } from '../reporter.js';

export type CreateOptions = {
  config: Config;
  namespace: Namespace;
  slug: string | undefined;
  cwd: string;
};

const isExists = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: string }).code === 'EEXIST';

/**
 * Writes a new Migration file from the template. The caller supplies a slug;
 * this layer turns it into the timestamped filename the rest of the CLI expects.
 */
export const create = async (options: CreateOptions): Promise<CreatedResult> => {
  const { config, namespace, slug: rawSlug, cwd } = options;
  const slug = slugify(rawSlug ?? '');

  if (slug === '') {
    throw new MigrationsError(
      'Не указано имя миграции',
      'Передайте краткое описание: migrate create add-users-table.',
    );
  }

  const dir = directoryOf(config, namespace);
  await assertMigrationsDirectory(dir);

  const fileName = migrationFileName(slug, new Date());
  const absolutePath = join(dir, fileName);
  const name = basename(fileName, extname(fileName));

  try {
    await writeFile(absolutePath, migrationTemplate(), { encoding: 'utf8', flag: 'wx' });
  } catch (cause) {
    if (isExists(cause)) {
      throw new MigrationsError(
        `Файл миграции уже существует: ${fileName}`,
        'Выберите другое имя или дождитесь следующей секунды.',
        { cause },
      );
    }

    throw cause;
  }

  return {
    namespace,
    path: relative(cwd, absolutePath),
    name,
  };
};
