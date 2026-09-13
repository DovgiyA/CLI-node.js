import { pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';

type ModuleNamespace = { default?: unknown };

/**
 * The CommonJS namespace tsx produces, marked as transpiled ES module output.
 * The marker is what distinguishes it from a Config that happens to export an
 * object with its own `default` key.
 */
const isTranspiledNamespace = (value: unknown): value is ModuleNamespace =>
  typeof value === 'object' &&
  value !== null &&
  (value as { __esModule?: unknown }).__esModule === true;

/**
 * Imports a TypeScript file a consumer project wrote — its Config or a
 * Migration — without asking the user to build it or to know that a loader
 * exists.
 *
 * `register()` is deliberately not used: on Node 20 it leaves dynamic imports
 * of `.ts` files unhandled. `tsImport` transpiles to CommonJS, so the real
 * module namespace arrives wrapped one level deep and has to be unwrapped.
 */
export const importTypeScript = async (path: string): Promise<ModuleNamespace> => {
  const namespace = (await tsImport(pathToFileURL(path).href, import.meta.url)) as ModuleNamespace;

  return isTranspiledNamespace(namespace.default) ? namespace.default : namespace;
};
