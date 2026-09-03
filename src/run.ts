import { createRequire } from 'node:module';

import { Command, CommanderError, InvalidArgumentError } from 'commander';

import { create } from './commands/create.js';
import { init } from './commands/init.js';
import { down } from './commands/down.js';
import { status } from './commands/status.js';
import { up } from './commands/up.js';
import { loadConfig } from './config/load.js';
import { configDefaults, type Config } from './config/types.js';
import { reportFailure } from './failure.js';
import type { Io } from './io.js';
import type { Namespace } from './journal/journal.js';
import { createLogger, isLoggerKind, type LoggerKind } from './logger.js';
import { createReporter } from './reporter.js';
import { parseDownSelection, parseUpSelection } from './selection/parse.js';

export const exitSuccess = 0;
export const exitFailure = 1;

type GlobalOptions = {
  config?: string;
  env?: string;
  logger?: LoggerKind;
  strict?: boolean;
  force?: boolean;
};

const parseLoggerKind = (value: string): LoggerKind => {
  if (!isLoggerKind(value)) {
    throw new InvalidArgumentError('Допустимые значения: pretty, json.');
  }

  return value;
};

const parseStep = (value: string): number => {
  const step = Number.parseInt(value, 10);

  if (!Number.isInteger(step) || step < 1) {
    throw new InvalidArgumentError('Шаг должен быть целым числом не меньше 1.');
  }

  return step;
};

// Both `src/` and the built `dist/` sit one level below the manifest.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

type Cli = {
  program: Command;
  /** The flag wins; otherwise the Config decides, if we got far enough to read it. */
  loggerKind: () => LoggerKind;
};

const buildCli = (io: Io): Cli => {
  const program = new Command();
  let loggerFromConfig: LoggerKind | undefined;

  program
    .name('migrate')
    .description('Кросспроектный CLI для миграций БД')
    .version(version)
    .option('-c, --config <path>', 'путь к файлу конфига')
    .option('-e, --env <name>', 'окружение, передаваемое в конфиг-функцию')
    .option('--logger <kind>', 'формат логов: pretty или json', parseLoggerKind)
    .option('--strict', 'считать Drift ошибкой')
    .option('--force', 'пропустить подтверждение отката вне dev')
    .exitOverride()
    .configureOutput({
      writeOut: (chunk) => io.stdout.write(chunk),
      writeErr: (chunk) => io.stderr.write(chunk),
    });

  const currentLoggerKind = (): LoggerKind =>
    program.opts<GlobalOptions>().logger ?? loggerFromConfig ?? configDefaults.logger;

  const currentStrict = (): boolean => program.opts<GlobalOptions>().strict === true;
  const currentForce = (): boolean => program.opts<GlobalOptions>().force === true;

  const readConfig = async (): Promise<Config> => {
    const { config: explicitPath, env: envFlag } = program.opts<GlobalOptions>();

    const config = await loadConfig({
      cwd: io.cwd,
      explicitPath,
      envFlag,
      nodeEnv: io.env.NODE_ENV,
    });

    loggerFromConfig = config.logger;
    return config;
  };

  program.command('init').description('создать структуру проекта').action(async () => {
    const loggerKind = currentLoggerKind();
    const result = await init({ cwd: io.cwd });
    createReporter(loggerKind, io).init(result);
  });

  program
    .command('create')
    .description('создать файл миграции из шаблона')
    .argument('[slug]', 'краткое описание миграции')
    .action(async (slug: string | undefined) => {
      const config = await readConfig();
      const loggerKind = currentLoggerKind();

      const result = await create({
        config,
        namespace: 'migrations',
        slug,
        cwd: io.cwd,
      });

      createReporter(loggerKind, io).created(result);
    });

  const registerRunCommands = (
    parent: Command,
    namespace: Namespace,
    descriptions: { up: string; down: string; status: string },
  ): void => {
    parent
      .command('up')
      .description(descriptions.up)
      .option('--step <count>', 'применить N следующих Pending Migration', parseStep)
      .option('--to <name>', 'применить вплоть до Migration включительно')
      .action(async function (this: Command) {
        const config = await readConfig();
        const loggerKind = currentLoggerKind();
        const { step, to } = this.opts<{ step?: number; to?: string }>();

        const result = await up({
          config,
          namespace,
          logger: createLogger(loggerKind, io),
          selection: parseUpSelection({ step, to }),
          strict: currentStrict(),
        });

        createReporter(loggerKind, io).applied(result);
      });

    parent
      .command('down')
      .description(descriptions.down)
      .option('--step <count>', 'откатить N последних Executed Migration', parseStep)
      .option('--to <name>', 'откатить до Migration, оставив её применённой')
      .option('--all', 'откатить все Executed Migration')
      .action(async function (this: Command) {
        const config = await readConfig();
        const loggerKind = currentLoggerKind();
        const { step, to, all } = this.opts<{ step?: number; to?: string; all?: boolean }>();

        const result = await down({
          config,
          namespace,
          logger: createLogger(loggerKind, io),
          selection: parseDownSelection({ step, to, all }),
          strict: currentStrict(),
          force: currentForce(),
          io,
        });

        createReporter(loggerKind, io).reverted(result);
      });

    parent.command('status').description(descriptions.status).action(async () => {
      const config = await readConfig();
      const result = await status({
        config,
        namespace,
        logger: createLogger(currentLoggerKind(), io),
        strict: currentStrict(),
      });

      createReporter(currentLoggerKind(), io).status(result);
    });
  };

  registerRunCommands(program, 'migrations', {
    up: 'применить миграции',
    down: 'откатить миграции',
    status: 'показать состояние миграций',
  });

  registerRunCommands(program.command('seed').description('наполнить базу данными'), 'seeders', {
    up: 'применить Seeder',
    down: 'откатить Seeder',
    status: 'показать состояние Seeder',
  });

  return { program, loggerKind: currentLoggerKind };
};

/**
 * The seam the test suite drives. `bin` does nothing but call this and exit
 * with the code it returns.
 */
export const run = async (argv: readonly string[], io: Io): Promise<number> => {
  const { program, loggerKind } = buildCli(io);

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exitSuccess;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already wrote help, a version string, or its own diagnostic.
      return error.exitCode === 0 ? exitSuccess : exitFailure;
    }

    reportFailure(error, loggerKind(), io);
    return exitFailure;
  }
};
