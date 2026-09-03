import { existsSync } from 'node:fs';
import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const entry = join(packageRoot, 'dist', 'index.js');

/**
 * The built entry point, as a consumer project would import it — undefined when
 * `dist` is absent, so tests that need it can skip instead of failing.
 */
export const packageEntry: string | undefined = existsSync(entry) ? entry : undefined;

/** Makes `@alex/migrate` resolvable from a throwaway consumer project. */
export const linkMigratePackage = async (cwd: string): Promise<void> => {
  const linkPath = join(cwd, 'node_modules', '@alex', 'migrate');
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(packageRoot, linkPath, 'dir');
};
