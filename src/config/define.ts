import type { ConfigModule } from './types.js';

/**
 * Identity at runtime; exists so a consumer project gets type inference and
 * completion while writing its Config.
 */
export const defineConfig = <T extends ConfigModule>(config: T): T => config;
