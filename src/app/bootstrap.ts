import 'reflect-metadata';
import 'dotenv/config';
import { getDataSource, closeDataSource } from '../infrastructure/db/connection.js';
import { createContainer } from './container.js';
import { getLogger } from '../shared/logger/index.js';
import { getEnv } from '../shared/config/env.js';

async function bootstrap(): Promise<void> {
  const logger = getLogger();
  const env = getEnv();

  try {
    logger.info('Starting VPNoodles bot...');

    // Initialize database
    logger.info('Connecting to database...');
    await getDataSource();
    logger.info('Database connected');

    // Create container with all dependencies
    const container = createContainer();

    // Register bot handlers
    container.handlers.register();

    // Start bot
    if (env.TELEGRAM_WEBHOOK_URL) {
      // Webhook mode for production
      const webhookPath = `/bot${env.TELEGRAM_BOT_TOKEN}`;
      await container.bot.telegram.setWebhook(env.TELEGRAM_WEBHOOK_URL + webhookPath);
      const webhookInfo = await container.bot.telegram.getWebhookInfo();
      logger.info({ webhookInfo }, 'Bot started with webhook');
      // In webhook mode, use bot.createWebhook() with an HTTP server
      // For now, we use polling in dev and document webhook setup in README
      container.bot.launch();
    } else {
      // Polling mode for development
      await container.bot.launch();
      logger.info('Bot started with polling');
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down...');
      container.bot.stop(signal);
      await closeDataSource();
      await container.cacheService.disconnect();
      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    logger.info('VPNoodles bot is running!');
  } catch (error) {
    logger.error({ error }, 'Failed to start bot');
    process.exit(1);
  }
}

bootstrap();
