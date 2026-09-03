import { defaultConfigFilename } from '../config/locate.js';

export const migrationsDir = 'migrations';
export const seedersDir = 'seeders';
export const exampleMigrationFile = '20260101T000000-example.ts';
export const exampleMigrationPath = `${migrationsDir}/${exampleMigrationFile}`;

export const configPath = defaultConfigFilename;
