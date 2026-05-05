import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),

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

  // Payments
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
  YOOKASSA_WEBHOOK_URL: z.string().optional(),

  // App
  TRIAL_DURATION_DAYS: z.coerce.number().default(3),
  TRIAL_DEVICE_LIMIT: z.coerce.number().default(1),
  SUPPORT_USERNAME: z.string().default('support'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}
