# VPNoodles2 — Telegram VPN Bot

Production-ready Telegram VPN-бот с интеграцией Remnawave. TypeScript, чистая архитектура, модульность.

## 🏗 Архитектура

### Почему так

- **Слоистая структура** — чёткое разделение ответственности: `domain` → `application` → `infrastructure` → `transport`. Зависимости направлены внутрь, бизнес-логика не зависит от Telegram или БД.
- **DI через фабрику** — `container.ts` собирает все зависимости вручную (без DI-фреймворка). Легко подменять реализации для тестов.
- **Use Cases** — каждый сценарий пользователя — отдельный класс с одним методом `execute()`. Легко тестировать и расширять.
- **Интерфейсы сервисов** — `IRemnawaveService`, `IPaymentService`, `ICacheService` — позволяют менять реализации без изменения бизнес-логики.
- **Telegram-обработчики — тонкие композиционные корни** — `BotHandlers`/`AdminHandlers` не содержат логику сами, а собирают и регистрируют отдельные классы-обработчики по доменным группам (оплата, подписки, устройства / обзор, списки, миграция, рассылки).
- **Idempotency на платежах** — Redis-лок на фулфилмент конкретного платежа предотвращает двойную активацию при гонке webhook/polling (см. `PurchasePlanUseCase`, `PaymentOrchestrator`).
- **Кэш чтения из Remnawave** — самый горячий GET (`getUserSubscriptionState`) кэшируется в Redis с инвалидацией при любой мутации того же пользователя.
- **Структурированное логирование** — pino с JSON-форматом для production.

### Структура проекта

```
src/
├── app/                    # Точка входа
│   ├── bootstrap.ts        # Запуск бота, HTTP-сервер, планировщики (polling, напоминания)
│   └── container.ts        # Ручная сборка зависимостей (без DI-фреймворка)
├── domain/                 # Доменный слой (ядро)
│   ├── entities/           # User, Plan, Subscription, Payment, AuditLog, NotificationLog
│   └── interfaces/         # Контракты (репозитории, сервисы)
├── application/            # Use cases (бизнес-логика)
│   └── usecases/
│       ├── shared/         # Общая логика между похожими usecase (напр. напоминания об истечении)
│       └── ...              # RegisterUser, ActivateTrial, PurchasePlan, RenewSubscription,
│                             # DeactivateBlockedUser, RestoreBlockedUser, SendXReminders, Sync*, Migrate*
├── infrastructure/         # Инфраструктура
│   ├── db/                 # TypeORM подключение, репозитории, миграции, сиды
│   ├── remnawave/          # RemnawaveClient — единый адаптер (retry, timeout, GET-modify-PATCH, Redis-кэш статуса)
│   ├── payments/           # PaymentOrchestrator, YooKassaService, polling-fulfillment
│   ├── notifications/      # NotificationService, детект блокировки бота Telegram
│   ├── cache/               # Redis cache (ICacheService)
│   └── qrcode/             # QR-code генерация
├── transport/              # Транспортный слой
│   └── telegram/
│       ├── handlers.ts     # BotHandlers — композиционный корень (навигация + сборка групп)
│       ├── user/            # PaymentHandlers, SubscriptionHandlers, DeviceHandlers
│       ├── admin/           # AdminHandlers (корень) + Overview/List/Migration/Broadcast + adminShared
│       ├── keyboards.ts, texts.ts
└── shared/                 # Общий код
    ├── config/             # Env-конфигурация (Zod, singleton)
    ├── errors/             # Иерархия ошибок (включая PaymentLockedError)
    ├── logger/             # Pino logger
    ├── types/              # Общие типы
    └── utils/              # Утилиты
```

## 🚀 Быстрый старт

### Требования

- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### Установка

```bash
# Клонировать репозиторий
git clone <repo-url> && cd vpnoodles2

# Установить зависимости
npm install

# Скопировать и заполнить .env
cp .env.example .env
# Отредактируйте .env — укажите TELEGRAM_BOT_TOKEN, DATABASE_URL, REMNAWAVE_API_URL, REMNAWAVE_API_KEY

# Запустить PostgreSQL и Redis (через Docker)
docker compose up -d postgres redis

# Применить миграции и сиды
npm run migrate
npm run seed

# Запустить в dev-режиме
npm run dev
```

### Docker

```bash
# Запустить всё (app + postgres + redis)
docker compose up -d

#Обновить и перезапустить
git pull
docker compose up -d --build app

# Применить миграции
docker compose exec app npm run migrate
docker compose exec app npm run seed

```

Обычный деплой на прод (тот же сервер) — `bash deploy.sh`. Перенос на **новый**
VPS (весь чек-лист: `.env`, база, nginx, DNS/webhook) — [`docs/VPS_MIGRATION.md`](docs/VPS_MIGRATION.md) + `bash migrate-vps.sh`.
`bash migrate-vps.sh --export`              # на старом VPS → делает дамп + считает users/subscriptions/payments/audit_logs
`bash migrate-vps.sh --import <файл>`       # на новом VPS → восстанавливает, сверяет числа
`bash migrate-vps.sh --verify`              # просто посмотреть текущие цифры в базе

## 📋 Скрипты

| Скрипт            | Описание                           |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Dev-режим с hot-reload (tsx watch) |
| `npm run build`   | Сборка TypeScript → dist/          |
| `npm run start`   | Production запуск                  |
| `npm run lint`    | ESLint проверка ⚠️ сейчас не работает — конфиг в старом формате, а установлен ESLint v9 (нужен `eslint.config.js`) |
| `npm run test`    | Запуск тестов (Jest)               |
| `npm run migrate` | Синхронизация схемы БД             |
| `npm run migrate:safe` | Безопасная миграция схемы (guarded) |
| `npm run seed`    | Заполнение начальными данными      |

## 🔑 Переменные окружения

См. `.env.example` для полного списка. Обязательные:

- `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather
- `DATABASE_URL` — PostgreSQL connection string
- `REMNAWAVE_API_URL` — URL панели Remnawave
- `REMNAWAVE_API_KEY` — API-ключ Remnawave

## 📱 Основной флоу

1. `/start` → Приветствие + выбор тарифа (либо экран восстановления доступа, если пользователь ранее заблокировал бота — см. ниже)
2. **Бесплатный тариф** → Активация trial
3. **Платный тариф** → Выбор плана → Оплата (Telegram Stars или ЮKassa) → Выдача VPN
4. **Мой VPN** → Статус подписки, ссылка, QR-код, инструкция
5. **Продлить** → Выбор тарифа для продления
6. **Поддержка** → Контакт с поддержкой

### Оплата (ЮKassa)

Основной механизм сверки платежей — **polling**, а не webhook: фоновый тик (`YOOKASSA_POLL_INTERVAL_MS`) регулярно проверяет pending-платежи через API ЮKassa и активирует подписку сам. Webhook-эндпоинт (`/webhook/yookassa`) в коде есть и рабочий, но сейчас не зарегистрирован в кабинете ЮKassa. Оба пути (и Telegram Stars `successful_payment`) ведут в `PurchasePlanUseCase`, которая берёт Redis-лок на конкретный платёж перед выдачей — это защита от гонки, если polling и webhook (или два тика подряд) попытаются активировать один и тот же платёж одновременно.

### Напоминания и блокировка бота

Три фоновых сценария (`NOTIFICATIONS_TICK_INTERVAL_MS`): нет подписки, скоро закончится trial, скоро закончится платная подписка. Если при отправке Telegram возвращает «бот заблокирован» — пользователь автоматически помечается неактивным в БД и его доступ приостанавливается в Remnawave (не тратим слоты и продления на недостижимых). При повторном `/start` показывается кнопка восстановления доступа.

## 🧪 Тесты

```bash
npm run test                              # весь набор
npx jest tests/path/to/File.test.ts       # один файл
npx jest -t "название теста"              # по имени
```

Use case'ы и инфраструктурные классы тестируются на ручных моках интерфейсов (`{ method: jest.fn() }`), без библиотек мокирования. `RemnawaveClient` тестируется через мок `global.fetch`, а не мок класса. Покрыто в т.ч.:

- Гонка double-fulfillment платежа (Redis-лок в `PurchasePlanUseCase`/`PaymentOrchestrator`)
- Точная форма PATCH-payload в `RemnawaveClient` для каждого мутирующего метода
- Кэш статуса подписки Remnawave (попадание/промах/инвалидация при мутации)
- N+1-регрессия в напоминаниях (батч-запрос вместо запроса на каждого пользователя)
- Детект блокировки бота и деактивация/восстановление пользователя
- Активация trial, платёжный оркестратор (создание, верификация, отмена, idempotency)

## 🔒 Безопасность

- Idempotency на платежах через атомарный Redis-лок (`SET NX EX`, не `exists()+set()`)
- Zod-валидация env-переменных
- Глобальная обработка ошибок
- Audit Log для всех значимых действий (покупки, синхронизация, миграция, блокировки/восстановления)
- Никакой бизнес-логики в handler'ах — только вызов use case'ов

## 📦 Сущности БД

- **User** — пользователь Telegram (`isActive` — используется для отключения заблокировавших бота)
- **Plan** — тариф (trial/paid)
- **Subscription** — подписка с привязкой к Remnawave
- **Payment** — платёж (Stars/YooKassa/Crypto)
- **AuditLog** — аудит значимых действий
- **NotificationLog** — журнал отправленных напоминаний/рассылок (дедупликация + статистика в админке)

## 🔄 Remnawave Integration

Изолирована в `RemnawaveClient` — единый адаптер с:

- Retry (3 попытки с exponential backoff), timeout (10s по умолчанию), error mapping → `RemnawaveError`
- Все мутирующие методы (`suspendUser`, `resumeUser`, `updateDeviceLimit`, `updateUserTag`, `extendUser`, `upgradeUser`) идут через общий приватный `patchUser()` — GET текущего пользователя → PATCH с точечными переопределениями (API Remnawave принимает только полный объект)
- `getUserSubscriptionState` кэшируется в Redis (`REMNAWAVE_STATE_CACHE_TTL_SECONDS`, по умолчанию 10с), инвалидируется при любой мутации того же пользователя
- Методы: createUser, deleteUser, suspendUser, resumeUser, getSubscriptionUrl, updateDeviceLimit, updateUserTag, extendUser, upgradeUser, getUserSubscriptionState, getHwidDevices, getNodes

## 📄 Лицензия

ISC
