import 'reflect-metadata';
import 'dotenv/config';
import { getDataSource } from './connection.js';
import { getLogger } from '../../shared/logger/index.js';

async function migrate(): Promise<void> {
  const logger = getLogger();

  try {
    const ds = await getDataSource();
    await ds.synchronize(true);
    logger.info('Database schema synchronized');
    await ds.destroy();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

migrate();
