import 'reflect-metadata';
import 'dotenv/config';
import { getDataSource } from './connection.js';
import { getLogger } from '../../shared/logger/index.js';

/**
 * БЕЗОПАСНАЯ синхронизация схемы БД.
 *
 * В отличие от migrate.ts (который вызывает synchronize(true) — деструктивно,
 * удаляет все таблицы и данные), этот скрипт вызывает synchronize() без флага
 * dropBeforeSync: TypeORM только СОЗДАЁТ недостающие таблицы/колонки
 * и не трогает существующие данные.
 *
 * Использование: npm run migrate:safe
 */
async function migrateSafe(): Promise<void> {
  const logger = getLogger();

  try {
    const ds = await getDataSource();
    // synchronize() без аргументов = dropBeforeSync: false → недеструктивно.
    await ds.synchronize();
    logger.info('Database schema synchronized (safe, non-destructive)');
    await ds.destroy();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Safe migration failed');
    process.exit(1);
  }
}

migrateSafe();
