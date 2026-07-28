import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  /** Порт веб-админки (отдельный Express-сервер, поднимается рядом с основным HTTP-сервером). */
  ADMIN_PORT: z.coerce.number().default(3001),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  ADMIN_TELEGRAM_ID: z.coerce.number().optional(),
  ADMIN_TELEGRAM_IDS: z.string().optional(),
  /**
   * Логин/пароль для входа в веб-админку в обход Telegram Login Widget —
   * ТОЛЬКО для локальной разработки (виджет требует зарегистрированный в
   * BotFather HTTPS-домен, что неудобно гонять на каждый рестарт туннеля).
   * Работает, только если NODE_ENV !== 'production' — см. createAuthRouter.
   */
  ADMIN_DEV_USERNAME: z.string().optional(),
  ADMIN_DEV_PASSWORD: z.string().optional(),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().default(5432),
  DATABASE_NAME: z.string().default('vpnoodles'),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string().default('postgres'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Remnawave
  REMNAWAVE_API_URL: z.string().min(1),
  REMNAWAVE_API_KEY: z.string().min(1),
  REMNAWAVE_TIMEOUT_MS: z.coerce.number().default(10000),
  REMNAWAVE_DEFAULT_SQUAD: z.string().default(''),
  /** TTL кэша статуса подписки (getUserSubscriptionState) в Redis, сек. 0 — кэш выключен. */
  REMNAWAVE_STATE_CACHE_TTL_SECONDS: z.coerce.number().default(10),

  // Payments
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
  YOOKASSA_WEBHOOK_URL: z.string().optional(),
  /** Интервал опроса ЮKassa для pending-платежей (мс). 0 — отключить (нужен webhook). */
  YOOKASSA_POLL_INTERVAL_MS: z.coerce.number().default(45000),
  TELEGRAM_PROVIDER_TOKEN: z.string().optional(),
  PAYMENT_PENDING_TTL_MINUTES: z.coerce.number().default(10),

  // App
  TRIAL_DURATION_DAYS: z.coerce.number().default(14),
  TRIAL_DEVICE_LIMIT: z.coerce.number().default(2),
  TRIAL_TRAFFIC_LIMIT_GB: z.coerce.number().default(2),
  TRIAL_TRAFFIC_STRATEGY: z.enum(['NO_RESET', 'DAY', 'MONTH']).default('DAY'),
  SUPPORT_USERNAME: z.string().default('support'),

  // Notifications
  NOTIFICATIONS_ENABLED: z
    .preprocess(
      (val) => {
        if (val === undefined || val === null) return true;
        if (typeof val === 'boolean') return val;
        return String(val).toLowerCase() === 'true';
      },
      z.boolean(),
    )
    .default(true),
  /** Интервал работы планировщика уведомлений (мс). */
  NOTIFICATIONS_TICK_INTERVAL_MS: z.coerce.number().default(600000),
  /** Через сколько часов после регистрации отправить первое напоминание «нет подписки». */
  NOTIFICATION_NO_SUB_FIRST_DELAY_HOURS: z.coerce.number().default(1),
  /** Через сколько дней после регистрации отправить второе напоминание «нет подписки». */
  NOTIFICATION_NO_SUB_SECOND_DELAY_DAYS: z.coerce.number().default(3),
  /** За сколько дней до окончания бесплатного периода слать напоминание о продлении. */
  NOTIFICATION_TRIAL_EXPIRING_DAYS: z.coerce.number().default(2),
  /** За сколько дней до окончания платной подписки слать напоминание о продлении. */
  NOTIFICATION_PAID_EXPIRING_DAYS: z.coerce.number().default(2),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}
