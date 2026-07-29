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

**Web admin panel** (`admin-panel/`) is a separate Vite+React+TS project with its own `package.json`/`node_modules` — not part of the root `npm install`/`npm test`.

```bash
cd admin-panel && npm install     # only needed once / when its deps change
npm run build:panel                # from repo root — builds admin-panel/dist (backend serves it as static)
cd admin-panel && npm run dev      # panel-only dev server on :5173, proxies /api to ADMIN_PORT (vite.config.ts)
```

`npm run build`/`npm start` at the repo root do **not** build the panel — before a production deploy you need both `npm run build` and `npm run build:panel`. The Dockerfile already does both (separate `panel-builder` stage, see below) and `deploy.sh` goes through the Dockerfile, so the normal `bash deploy.sh` flow is covered — only a manual (non-Docker) run needs to remember both commands.

## Architecture

Layered: `domain` (entities + repository/service interfaces) → `application/usecases` (one class per business scenario, single `execute()`) → `infrastructure` (TypeORM repos, Remnawave HTTP client, Redis cache, payments, Telegram notifications) → `transport/telegram` (Telegraf handlers) and `transport/http` (Express admin panel API, see below). Dependencies point inward; use cases depend on interfaces (`domain/interfaces/*.ts`), not concrete infra classes. Everything is wired by hand in `src/app/container.ts` (no DI framework) — construction order matters there (e.g. `cacheService` must exist before `remnawaveService`, `deactivateBlockedUserUseCase` before `notificationService`).

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

### Web admin panel

A second, independent Express server (`src/transport/http/server.ts`) runs on its own port (`ADMIN_PORT`, default 3001) in the same process as the bot, alongside the existing raw `http.createServer` on `PORT` (3000, Telegram/YooKassa webhooks) — both are started from `bootstrap.ts`. The frontend is a separate Vite+React+TS project in `admin-panel/` (own `package.json`/`node_modules`, no shared deps with the backend); its build output (`admin-panel/dist`) is served as static files by the Express server (`express.static` + SPA fallback).

**Auth — Telegram Login Widget in prod, password only in dev, no JWT either way.** `POST /api/auth/telegram` verifies the widget's HMAC signature (`infrastructure/auth/TelegramWidgetAuth.ts::verifyTelegramWidgetAuth`, using `TELEGRAM_BOT_TOKEN`) and checks the Telegram id against `ADMIN_TELEGRAM_ID`/`ADMIN_TELEGRAM_IDS` via `shared/utils/adminIds.ts::parseAdminIds` — the same allowlist the Telegram bot's own `isAdmin()` uses, kept in one place deliberately. `POST /api/auth/dev-login` (password, for local dev without BotFather/HTTPS domain hassle) is only *registered* — not just guarded — when `NODE_ENV !== 'production'` and both `ADMIN_DEV_USERNAME`/`ADMIN_DEV_PASSWORD` are set (`routes/auth.ts`), so it's structurally absent in prod, not just disabled. Both paths create the same kind of session: a random token in Redis (`admin:session:{id}`, 7-day TTL, via `ICacheService` — not a JWT, so no extra secret and logout is just `cacheService.delete()`). `transport/http/middleware/adminAuth.ts::createRequireAdminAuth` reads the `admin_session` cookie against that.

**Two `helmet()` settings in `server.ts` exist only because the Telegram widget breaks without them — don't "clean up" them as unused-looking config:**
- CSP `script-src` needs `'unsafe-eval'` + `https://telegram.org` (the widget's own script uses `eval()` internally) and `frame-src` needs `https://oauth.telegram.org`.
- `crossOriginOpenerPolicy` must be `{ policy: 'same-origin-allow-popups' }`, not helmet's default `same-origin`. The widget's confirm step opens a `window.open()` popup to `oauth.telegram.org` and reports back via `postMessage`/`window.opener`; the default COOP silently severs that relationship — the popup opens, does nothing, and closes itself, with no console error and no failed network request on our side to point at the cause.

`app.set('trust proxy', 1)` is also required (app sits behind nginx on the VPS) — without it `express-rate-limit` throws on the `X-Forwarded-For` header nginx adds.

**Deployment gotchas already hit in prod, worth re-checking if "the panel/bot stopped working" after a deploy:**
- `docker-compose.yml`'s port mapping is `${ADMIN_PORT}:${ADMIN_PORT}` (from `.env`), not hardcoded, specifically so it can be moved off a port something else on the VPS is already using without a compose edit.
- The bot's Telegram webhook (`TELEGRAM_WEBHOOK_URL`) is handled by the *unrelated* raw server on `PORT`/3000 — nginx must proxy that domain to 3000, not to `ADMIN_PORT`. Get this wrong and Telegram just gets 502s and stops delivering updates silently (no error in the bot's own logs, only in `getWebhookInfo().last_error_message` on Telegram's side) — looks exactly like "the bot is broken" with no obvious link to nginx.
- The Dockerfile has a separate `panel-builder` stage (its own `npm ci`, doesn't touch the backend's `node_modules`) whose `admin-panel/dist` gets copied to `/app/admin-panel/dist` in the final image. That path is load-bearing: `server.ts` resolves the static dir via `path.resolve(__dirname, '../../../admin-panel/dist')`, assuming the compiled backend lives at `dist/transport/http/server.js` — if that relative depth ever changes, this breaks silently (server serves 404s for the SPA, API routes still work).

**Backend routes** (`src/transport/http/routes/*.ts`) mirror the Telegram side's layering — thin, one file per resource (`auth`, `overview`, `users`, `payments`, `notifications`, `logs`), each calling into `application/usecases/*` the same way Telegram handlers do. Everything except `/api/auth/*` sits behind `requireAdminAuth`. List endpoints share one pagination convention (`transport/http/pagination.ts::parsePagination`, `?page=&pageSize=`) and return `{ items, total, page, pageSize }`. Rows that reference a user (payments, notification logs, audit logs) always include a raw `userId` alongside the human-readable `userLabel` (`shared/utils/userLabel.ts::formatUserLabel`) specifically so the frontend can link to `/users/:id` — don't drop `userId` from a new list DTO just because the label looks sufficient on its own.

**Frontend** (`admin-panel/src/`) uses `react-router-dom` client-side only (no loaders/actions/SSR). `pages/DashboardLayout.tsx` fetches `/api/overview` once and exposes it via `useOutletContext<DashboardOutletContext>()` to the pages that just read that blob (Overview/Revenue/Servers); pages with their own pagination/filtering (Payments/Notifications/Logs/Users) do their own fetching instead of touching that context. There's no test runner configured for `admin-panel/` — verify changes by building (`cd admin-panel && npm run build`) and driving a locally-started server (fake `AdminHttpServerDeps`, no real DB/Telegram/Remnawave) through a browser; write a throwaway `verify-admin-server.ts` at the repo root for this, use it, then delete it — don't commit it.

### Testing conventions

Use cases and infra classes are tested with hand-written mock objects matching the relevant interface (`{ methodName: jest.fn() }`), not a mocking framework — see any file under `tests/usecases/` or `tests/infrastructure/` for the pattern. `tests/infrastructure/RemnawaveClient.test.ts` mocks `global.fetch` directly rather than mocking the class. `RedisCacheService`/`ICacheService` mocks are often a real in-memory `Map`-backed fake (see `createFakeCache()` in the RemnawaveClient tests) rather than jest.fn() stubs, when TTL/invalidation behavior actually needs to be exercised.

`tests/transport/http/*.test.ts` cover the admin panel's Express routes via `supertest` against `createAdminHttpApp(...)` built with the same kind of fake `ICacheService`/use-case mocks — one real session is created directly with `middleware/adminAuth.ts::createAdminSession` (skip re-deriving the Telegram HMAC signature in every test) and reused as a cookie across requests. Every new route needs at minimum a 401-without-session case and a happy-path case; see `tests/transport/http/adminListRoutes.test.ts` for the current shape.
