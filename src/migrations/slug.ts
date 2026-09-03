/**
 * Turns a human description into the stable suffix of a Migration filename.
 */
export const slugify = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** Compact timestamp prefix: `20251014T120000`. */
export const formatTimestamp = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T` +
  `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

export const migrationFileName = (slug: string, date: Date): string =>
  `${formatTimestamp(date)}-${slug}.ts`;
