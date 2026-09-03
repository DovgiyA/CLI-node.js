# @alex/migrate

Кросспроектный CLI для версионирования схемы Postgres: применение, откат и просмотр состояния **Migration** и **Seeder**. Инструмент привязывается к проекту только через **Config** в рабочей директории — один и тот же пакет работает в любом репозитории.

## Установка

```bash
npm install --save-dev @alex/migrate
```

В `package.json` добавьте скрипты (CLI их не меняет, только предлагает при `migrate init`):

```json
{
  "scripts": {
    "migrate:up": "migrate up",
    "migrate:down": "migrate down",
    "migrate:status": "migrate status",
    "migrate:create": "migrate create --"
  }
}
```

## Быстрый старт

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/myapp

migrate init
migrate create add-users-table
# отредактируйте созданный файл в migrations/
migrate up
migrate status
migrate down
```

Готовый проект-потребитель лежит в [`example/`](example/): конфиг, Migration и Seeder, которые можно скопировать или изучить.

## Команды

| Команда | Описание |
|---------|----------|
| `migrate init` | Создаёт `migrator.config.ts`, папку `migrations/` с примером и `seeders/`. Существующие файлы не перезаписываются. |
| `migrate create <slug>` | Создаёт файл Migration с временной меткой в имени, например `20260301T100000-add-users-table.ts`. |
| `migrate up` | Применяет Pending Migration. |
| `migrate down` | Откатывает последнюю Executed Migration (или по флагам выбора). |
| `migrate status` | Показывает состояние Migration: Executed, Pending или Missing. |
| `migrate seed up` | Применяет Pending Seeder из папки `seeders/`. |
| `migrate seed down` | Откатывает Seeder. |
| `migrate seed status` | Состояние Seeder. |

### Глобальные флаги

Применяются ко всем командам, кроме `init`:

| Флаг | Описание |
|------|----------|
| `-c, --config <path>` | Путь к конфигу (по умолчанию `migrator.config.ts` в cwd). |
| `-e, --env <name>` | Окружение для конфиг-функции. Умолчание: `NODE_ENV`, затем `dev`. |
| `--logger <kind>` | `pretty` (таблицы) или `json` (одна JSON-строка в stdout). Перекрывает поле `logger` в конфиге. |
| `--strict` | Drift считается ошибкой, а не предупреждением. |
| `--force` | Пропустить интерактивное подтверждение отката вне `dev`. |

### Флаги выбора (`up` / `down` / `seed up` / `seed down`)

| Флаг | Команды | Описание |
|------|---------|----------|
| `--step <N>` | up, down | Применить или откатить N Migration/Seeder. |
| `--to <name>` | up, down | **up:** вплоть до `<name>` включительно. **down:** откатить до `<name>`, оставив её применённой. |
| `--all` | down | Откатить все Executed Migration/Seeder. |

Флаги `--step` и `--to` взаимоисключающи.

## Конфиг

Файл `migrator.config.ts` (или путь из `--config`):

```typescript
export default {
  database: process.env.DATABASE_URL ?? '',
  env: 'dev',
  migrationsDir: 'migrations',
  seedersDir: 'seeders',
  pattern: '*.{ts,js}',
  transaction: 'each', // 'all' | 'each' | 'none'
  logger: 'pretty',    // 'pretty' | 'json'
};
```

Экспорт может быть объектом или синхронной функцией `(env) => ({ ... })`. Хелпер `defineConfig` из пакета даёт вывод типов.

Migration-файлы пишутся через `defineMigration`:

```typescript
import { defineMigration } from '@alex/migrate';

export default defineMigration({
  // transaction: false, // для CREATE INDEX CONCURRENTLY и подобного
  up: async ({ sql, logger }) => {
    await sql.query('create table users (id integer primary key)');
  },
  down: async ({ sql }) => {
    await sql.query('drop table users');
  },
});
```

## Режимы транзакций

| Режим | Поведение |
|-------|-----------|
| `all` | Весь Run в одной транзакции: при ошибке откатывается всё, Journal не меняется. |
| `each` | Транзакция на каждую Migration (по умолчанию). |
| `none` | Без транзакций. |

Отдельная Migration может объявить `transaction: false` — тогда она выполняется вне транзакции даже в режиме `each`.

**Окно рассогласования в режиме `none`:** если Migration упала после частичного изменения схемы, изменения могут остаться в базе, а запись в Journal — нет (или наоборот при сбое записи). Это принципиальное ограничение режима без транзакций; восстановление — вручную по подсказке в ошибке.

## Drift и Missing

**Drift** — Checksum файла Migration не совпадает с записью в Journal (файл изменили после применения). По умолчанию — предупреждение в stderr; с `--strict` Run завершается с кодом 1.

**Missing** — в Journal есть запись, файла на диске нет. Отображается в `status`, блокирует `down` для этой Migration, но не мешает применять новые.

Что делать:

- **Drift:** вернуть файл в состояние на момент применения или создать новую Migration с нужными изменениями.
- **Missing:** восстановить файл из git или удалить запись из Journal вручную, если откат больше не нужен.

## Потоки вывода и коды выхода

- **stdout** — результат команды (таблица или JSON).
- **stderr** — логи (pino).

Пример: `migrate status --logger json | jq .`

| Код | Значение |
|-----|----------|
| `0` | Успех |
| `1` | Любая ошибка: конфиг, Lock, упавшая Migration, Drift с `--strict`, Missing при откате и т.д. |

## Разработка и тесты

```bash
npm run db:up      # Postgres на localhost:54329 (docker compose)
npm test           # vitest, изолированные схемы
npm run test:bin   # subprocess-тесты собранного bin
npm run build
npm run typecheck
```

Переменные окружения для тестов:

| Переменная | Назначение |
|------------|------------|
| `TEST_DATABASE_URL` | URL Postgres для интеграционных тестов (по умолчанию `postgres://migrate:migrate@localhost:54329/migrate`). |
| `MIGRATE_SKIP_DB_TESTS=1` | Пропустить тесты, требующие БД (если Postgres недоступен). |

Остановить Postgres: `npm run db:down`.

## Пример проекта

Каталог [`example/`](example/) — минимальный потребитель с:

- `migrator.config.ts`
- Migration `20260101T000000-create-widgets.ts`
- Seeder `20260102T000000-seed-widgets.ts`

```bash
cd example
export DATABASE_URL=postgres://migrate:migrate@localhost:54329/migrate
npm install
npx migrate up
npx migrate seed up
npx migrate status
npx migrate down
npx migrate seed down
```
