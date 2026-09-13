import { createInterface } from 'node:readline/promises';

export type OutputStream = { write: (chunk: string) => void };

/**
 * Everything the CLI is allowed to touch outside of itself. Passing this in
 * rather than reaching for `process` is what makes `run` testable in-process.
 */
export type Io = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  isTty: boolean;
  stdout: OutputStream;
  stderr: OutputStream;
  /** Reads one line for interactive down confirmation outside dev. */
  readLine?: (prompt: string) => Promise<string>;
};

export const processIo = (): Io => ({
  cwd: process.cwd(),
  env: process.env,
  isTty: process.stdout.isTTY === true,
  stdout: { write: (chunk) => void process.stdout.write(chunk) },
  stderr: { write: (chunk) => void process.stderr.write(chunk) },
  readLine: async (prompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  },
});
