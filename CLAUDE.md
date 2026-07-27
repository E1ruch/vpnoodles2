# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Production Telegram VPN bot (Telegraf + TypeORM/Postgres + Redis) that provisions access through a Remnawave panel. Revenue-generating and in active use — prioritize correctness and backward compatibility over speed; this is not a greenfield project.

## Commands

```bash
npm run dev              # tsx watch src/app/bootstrap.ts — hot-reload dev server
npm run build             # tsc → dist/
npm run start             # node dist/app/bootstrap.js (production)
npm run test               # jest --verbose (full suite)
npx jest path/to/File.test.ts          # single test file
npx jest -t "test name substring"      # single test by name
npx tsc --noEmit           # typecheck only, no build output
npm run migrate            # tsx src/infrastructure/db/migrate.ts
npm run migrate:safe       # tsx src/infrastructure/db/migrate-safe.ts (guarded schema migration)
npm run seed                # tsx src/infrastructure/db/seed.ts
```

`npm run lint` is currently broken — the project has an old-format ESLint config but `eslint` in `devDependencies` is v9, which requires `eslint.config.js`. Don't spend time trying to "fix" code to satisfy lint; there is no working lint pipeline right now.

Local dev requires Postgres + Redis (`docker compose up -d postgres redis`); `.env` needs at minimum `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `REMNAWAVE_API_URL`, `REMNAWAVE_API_KEY` (see `.env.example`). Env is parsed once via Zod into a module-level singleton (`shared/config/env.ts`, `getEnv()`) — it does not re-read `process.env` after first call in a process, which matters for tests (`tests/jest.setup.ts` seeds required vars before anything imports `getEnv`).

## Architecture

Layered: `domain` (entities + repository/service interfaces) → `application/usecases` (one class per business scenario, single `execute()`) → `infrastructure` (TypeORM repos, Remnawave HTTP client, Redis cache, payments, Telegram notifications) → `transport/telegram` (Telegraf handlers). Dependencies point inward; use cases depend on interfaces (`domain/interfaces/*.ts`), not concrete infra classes. Everything is wired by hand in `src/app/container.ts` (no DI framework) — construction order matters there (e.g. `cacheService` must exist before `remnawaveService`, `deactivateBlockedUserUseCase` before `notificationService`).

### Telegram handlers are composition roots, not god objects

`transport/telegram/handlers.ts` (`BotHandlers`) and `transport/telegram/admin/AdminHandlers.ts` are thin composition roots. Each instantiates and delegates to per-domain handler classes that own their own `register(bot)`:

- `transport/telegram/user/`: `PaymentHandlers` (buy flow, YooKassa/Stars, pre_checkout, successful_payment), `SubscriptionHandlers` (plans, trial, renew, "Мой VPN"), `DeviceHandlers` (HWID device list/removal)
- `transport/telegram/admin/`: `AdminOverviewHandlers`, `AdminListHandlers`, `AdminMigrationHandlers`, `AdminBroadcastHandlers`, with shared auth/pagination/formatting helpers in `adminShared.ts` (`isAdmin`, `safeEditMessageText`, pagination, `formatUserLabel`)

`BotHandlers`'s own constructor is called from `container.ts`, so its param list is the one place a new cross-cutting dependency (e.g. a new use case needed by a sub-handler) has to be threaded through explicitly.

### Payment flow: polling-based, not webhook-driven in practice

YooKassa payments are reconciled by a polling tick (`infrastructure/payments/yooKassaFulfillment.ts`, driven by `YOOKASSA_POLL_INTERVAL_MS` in `bootstrap.ts`), not the webhook endpoint — the webhook handler in `bootstrap.ts` exists and works but isn't currently registered with YooKassa in production. Both paths (and a third, Telegram Stars' `successful_payment`) converge on `PurchasePlanUseCase.execute()`.

**`PurchasePlanUseCase.execute()` takes a Redis distributed lock keyed by paymentId before doing any fulfillment work** (`IPaymentService.acquireFulfillmentLock`/`releaseFulfillmentLock`, implemented in `PaymentOrchestrator`). This exists because the polling tick and webhook (or two overlapping polling ticks) can race on the same payment; `RemnawaveClient.extendUser()` is not idempotent (it adds days on top of whatever the current expiry is), so without the lock a race double-credits subscription days. If you see `PaymentLockedError` thrown/caught somewhere, that's this lock rejecting a concurrent fulfillment attempt — callers treat it as "already being handled," not a real failure.

The Redis lock itself must use `ICacheService.acquireLock`/`releaseLock` (atomic `SET NX EX`), not `exists()` + `set()` — that combination has a TOCTOU race.

### RemnawaveClient: GET-modify-PATCH, plus a state cache with mandatory invalidation

Remnawave's user-update API requires sending the full user object on every `PATCH /api/users`, so every mutating method (`suspendUser`, `resumeUser`, `updateDeviceLimit`, `updateUserTag`, `extendUser`, `upgradeUser`) goes through a shared private `patchUser(uuid, buildOverrides)` helper: GET current user → merge overrides → PATCH. When adding a new mutating method, use `patchUser`, don't hand-roll another GET+PATCH.

`getUserSubscriptionState()` (the hottest read path — hit on every "Мой VPN" view and by the reminder use cases) is cached in Redis for `REMNAWAVE_STATE_CACHE_TTL_SECONDS` (default 10s). `patchUser()` and `deleteUser()` invalidate that cache key after a successful mutation. **If you add a new method that changes a user's status or expiry in Remnawave, it must invalidate `remnawave:state:{uuid}` too**, or reads can serve stale data for up to the TTL right after a write.

### Reminder/notification system

Three scheduled use cases (driven from `bootstrap.ts` on `NOTIFICATIONS_TICK_INTERVAL_MS`): `SendNoSubscriptionRemindersUseCase`, `SendTrialExpiringRemindersUseCase`, `SendPaidExpiringRemindersUseCase`. The latter two share their tick logic via `application/usecases/shared/runExpiringReminderTick.ts` (they differ only in plan-type filter, text, keyboard, and metadata — don't duplicate that loop again for a new reminder type, extend the shared runner instead). Dedup is via `notification_logs` (`INotificationLogRepository.exists`, keyed by user/type/entityId/cycleKey).

All actual Telegram sends should go through `NotificationService.send()` (reminders) or the equivalent inline try/catch in `AdminBroadcastHandlers`/`AdminMigrationHandlers` — both paths detect a blocked-bot error (`infrastructure/notifications/telegramErrors.ts::isTelegramBlockedError`, matches Telegraf's `TelegramError` 403 "bot was blocked by the user" / "user is deactivated") and call `DeactivateBlockedUserUseCase`, which sets `users.isActive = false` and suspends the user's Remnawave access. `RestoreBlockedUserUseCase` reverses this when a deactivated user sends `/start` again (handled in `BotHandlers`, with a confirmation button rather than silent auto-restore). Any new bulk-send flow should call `isTelegramBlockedError` + `DeactivateBlockedUserUseCase` the same way, and should filter out `isActive === false` users up front rather than attempting (and wasting a Remnawave renewal on) known-unreachable users.

### Testing conventions

Use cases and infra classes are tested with hand-written mock objects matching the relevant interface (`{ methodName: jest.fn() }`), not a mocking framework — see any file under `tests/usecases/` or `tests/infrastructure/` for the pattern. `tests/infrastructure/RemnawaveClient.test.ts` mocks `global.fetch` directly rather than mocking the class. `RedisCacheService`/`ICacheService` mocks are often a real in-memory `Map`-backed fake (see `createFakeCache()` in the RemnawaveClient tests) rather than jest.fn() stubs, when TTL/invalidation behavior actually needs to be exercised.
