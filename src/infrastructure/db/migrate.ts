import 'reflect-metadata';
import 'dotenv/config';
import { getDataSource } from './connection.js';
import { getLogger } from '../../shared/logger/index.js';
import { getEnv } from '../../shared/config/env.js';

/**
 * ДЕСТРУКТИВНАЯ синхронизация схемы БД — synchronize(true) удаляет ВСЕ
 * таблицы и данные перед пересозданием. Только для локальной разработки.
 * Для прод-деплоя используй migrate:safe.
 */
async function migrate(): Promise<void> {
  const logger = getLogger();
  const env = getEnv();

  if (env.NODE_ENV === 'production') {
    logger.error(
      'migrate (synchronize(true)) is destructive and refuses to run with NODE_ENV=production. Use `npm run migrate:safe` instead.',
    );
    process.exit(1);
  }

  if (process.env['CONFIRM_DESTRUCTIVE_MIGRATE'] !== 'yes') {
    logger.error(
      'This drops every table and all data. Re-run with CONFIRM_DESTRUCTIVE_MIGRATE=yes to proceed.',
    );
    process.exit(1);
  }

  try {
    const ds = await getDataSource();
    await ds.synchronize(true);
    logger.info('Database schema synchronized (destructive)');
    await ds.destroy();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

migrate();
