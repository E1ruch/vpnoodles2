# VPNoodles2 — Telegram VPN Bot

Production-ready Telegram VPN-бот с интеграцией Remnawave. TypeScript, чистая архитектура, модульность.

## 🏗 Архитектура

### Почему так

- **Слоистая структура** — чёткое разделение ответственности: `domain` → `application` → `infrastructure` → `transport`. Зависимости направлены внутрь, бизнес-логика не зависит от Telegram или БД.
- **DI через фабрику** — `container.ts` собирает все зависимости. Легко подменять реализации для тестов.
- **Use Cases** — каждый сценарий пользователя — отдельный класс с одним методом `execute()`. Легко тестировать и расширять.
- **Интерфейсы сервисов** — `IRemnawaveService`, `IPaymentService`, `ICacheService` — позволяют менять реализации без изменения бизнес-логики.
- **Idempotency на платежах** — Redis-локи предотвращают двойную активацию.
- **Структурированное логирование** — pino с JSON-форматом для production.

### Структура проекта

```
src/
├── app/                    # Точка входа
│   ├── bootstrap.ts        # Запуск бота
│   └── container.ts        # DI-контейнер
├── domain/                 # Доменный слой (ядро)
│   ├── entities/           # Сущности БД (User, Plan, Subscription, Payment, AuditLog)
│   └── interfaces/         # Контракты (репозитории, сервисы)
├── application/            # Use cases (бизнес-логика)
│   └── usecases/           # RegisterUser, ActivateTrial, PurchasePlan, GetSubscription, RenewSubscription
├── infrastructure/         # Инфраструктура
│   ├── db/                 # TypeORM подключение, репозитории, миграции, сиды
│   ├── remnawave/          # Remnawave API клиент (retry, timeout, error mapping)
│   ├── payments/           # PaymentOrchestrator (Stars, YooKassa, Crypto)
│   ├── cache/               # Redis cache
│   └── qrcode/             # QR-code генерация
├── transport/              # Транспортный слой
│   └── telegram/           # Telegraf handlers, keyboards, texts
└── shared/                 # Общий код
    ├── config/             # Env-конфигурация (Zod)
    ├── errors/             # Иерархия ошибок
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

# Применить миграции
docker compose exec app npm run migrate
docker compose exec app npm run seed

```

## 📋 Скрипты

| Скрипт            | Описание                           |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Dev-режим с hot-reload (tsx watch) |
| `npm run build`   | Сборка TypeScript → dist/          |
| `npm run start`   | Production запуск                  |
| `npm run lint`    | ESLint проверка                    |
| `npm run test`    | Запуск тестов (Jest)               |
| `npm run migrate` | Синхронизация схемы БД             |
| `npm run seed`    | Заполнение начальными данными      |

## 🔑 Переменные окружения

См. `.env.example` для полного списка. Обязательные:

- `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather
- `DATABASE_URL` — PostgreSQL connection string
- `REMNAWAVE_API_URL` — URL панели Remnawave
- `REMNAWAVE_API_KEY` — API-ключ Remnawave

## 📱 Основной флоу

1. `/start` → Приветствие + выбор тарифа
2. **Бесплатный тариф** → Активация trial (7 дней, 1 устройство)
3. **Платный тариф** → Выбор плана → Оплата (Telegram Stars) → Выдача VPN
4. **Мой VPN** → Статус подписки, ссылка, QR-код, инструкция
5. **Продлить** → Выбор тарифа для продления
6. **Поддержка** → Контакт с поддержкой

## 🧪 Тесты

```bash
npm run test
```

Тесты покрывают критичные use-case:

- Активация trial (успех, повторная попытка, отсутствие плана)
- Платежный оркестратор (создание, верификация, отмена, idempotency)

## 🔒 Безопасность

- Idempotency на платежах через Redis-локи
- Zod-валидация env-переменных
- Глобальная обработка ошибок
- Audit Log для всех действий
- Никакой бизнес-логики в handler'ах

## 📦 Сущности БД

- **User** — пользователь Telegram
- **Plan** — тариф (trial/paid)
- **Subscription** — подписка с привязкой к Remnawave
- **Payment** — платёж (Stars/YooKassa/Crypto)
- **AuditLog** — аудит действий

## 🔄 Remnawave Integration

Изолирована в `RemnawaveClient` — единый адаптер с:

- Retry (3 попытки с exponential backoff)
- Timeout (10s по умолчанию)
- Error mapping → `RemnawaveError`
- Методы: createUser, deleteUser, suspendUser, resumeUser, getSubscriptionUrl, updateDeviceLimit, extendUser

## 📄 Лицензия

ISC
