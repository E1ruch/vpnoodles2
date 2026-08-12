import { DataSource } from 'typeorm';
import { getEnv } from '../../shared/config/env.js';
import { getLogger } from '../../shared/logger/index.js';
import { User } from '../../domain/entities/User.js';
import { Plan } from '../../domain/entities/Plan.js';
import { Subscription } from '../../domain/entities/Subscription.js';
import { Payment } from '../../domain/entities/Payment.js';
import { AuditLog } from '../../domain/entities/AuditLog.js';
import { NotificationLog } from '../../domain/entities/NotificationLog.js';
import { ReferralReward } from '../../domain/entities/ReferralReward.js';
import { ReferralSettings } from '../../domain/entities/ReferralSettings.js';
import { ServerCost } from '../../domain/entities/ServerCost.js';

let dataSource: DataSource | null = null;

export async function getDataSource(): Promise<DataSource> {
  if (dataSource?.isInitialized) return dataSource;

  const env = getEnv();
  const logger = getLogger();

  dataSource = new DataSource({
    type: 'postgres',
    url: env.DATABASE_URL,
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    entities: [
      User,
      Plan,
      Subscription,
      Payment,
      AuditLog,
      NotificationLog,
      ReferralReward,
      ReferralSettings,
      ServerCost,
    ],
    synchronize: env.NODE_ENV === 'development',
    logging: env.NODE_ENV === 'development',
    migrations: [],
    subscribers: [],
    // Явный размер пула: этот один процесс обслуживает и Telegram-хендлеры, и
    // admin-панель, и все scheduled-тики одновременно — дефолт pg (10) делится
    // между всеми ними. Настраивается через DATABASE_POOL_MAX.
    extra: {
      max: env.DATABASE_POOL_MAX,
    },
  });

  await dataSource.initialize();
  logger.info('Database connected');
  return dataSource;
}

export async function closeDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
    dataSource = null;
  }
}
