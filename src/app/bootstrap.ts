import 'reflect-metadata';
import 'dotenv/config';
import http from 'http';
import { getDataSource, closeDataSource } from '../infrastructure/db/connection.js';
import { createContainer } from './container.js';
import { getLogger } from '../shared/logger/index.js';
import { getEnv } from '../shared/config/env.js';
import { YooKassaService } from '../infrastructure/payments/YooKassaService.js';
import { runYooKassaFulfillmentTick } from '../infrastructure/payments/yooKassaFulfillment.js';

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

    // Create YooKassa service
    const yooKassaService = new YooKassaService();

    // Create HTTP server for webhooks
    const server = http.createServer(async (req, res) => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';

      // Health check
      if (url === '/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      // YooKassa webhook
      if (url === '/webhook/yookassa' && method === 'POST') {
        logger.info('Received YooKassa webhook');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);
            logger.info({ payload }, 'YooKassa webhook payload');

            const result = await yooKassaService.handleWebhook(payload);

            if (result.status === 'completed') {
              const paymentRow = await container.paymentRepo.findByExternalId(result.externalId);
              if (paymentRow) {
                await container.purchasePlanUseCase.execute(paymentRow.userId, paymentRow.planId, 'yookassa', {
                  existingPaymentId: paymentRow.id,
                  externalChargeId: result.externalId,
                });
                logger.info(
                  { userId: paymentRow.userId, planId: paymentRow.planId },
                  'Subscription activated via YooKassa webhook',
                );
              } else {
                logger.warn({ externalId: result.externalId }, 'YooKassa webhook: payment not found in DB');
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (error) {
            logger.error({ error }, 'Error processing YooKassa webhook');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
        return;
      }

      // Telegram webhook
      if (url.startsWith(`/bot${env.TELEGRAM_BOT_TOKEN}`) && method === 'POST') {
        // Let telegraf handle it
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    const port = env.PORT;

    const pollMs = env.YOOKASSA_POLL_INTERVAL_MS;
    if (pollMs > 0 && yooKassaService.isConfigured()) {
      const tick = () => {
        runYooKassaFulfillmentTick(
          {
            paymentRepo: container.paymentRepo,
            purchasePlanUseCase: container.purchasePlanUseCase,
            userRepo: container.userRepo,
            qrCodeService: container.qrCodeService,
            bot: container.bot,
          },
          yooKassaService,
        ).catch((err) => logger.warn({ err }, 'YooKassa poll run failed'));
      };
      setInterval(tick, pollMs);
      setTimeout(tick, 8000);
      logger.info({ pollMs }, 'YooKassa pending payments polling enabled');
    } else if (!yooKassaService.isConfigured()) {
      logger.info('YooKassa polling skipped (not configured)');
    } else {
      logger.info('YooKassa polling disabled (YOOKASSA_POLL_INTERVAL_MS=0); use webhook for redirect payments');
    }

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down...');
      container.bot.stop(signal);
      server.close();
      await closeDataSource();
      await container.cacheService.disconnect();
      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    server.listen(port, () => {
      logger.info({ port }, 'HTTP server started');
      logger.info(`YooKassa webhook URL: http://your-domain.com/webhook/yookassa`);
    });

    if (env.TELEGRAM_WEBHOOK_URL) {
      const webhookPath = `/bot${env.TELEGRAM_BOT_TOKEN}`;
      await container.bot.telegram.setWebhook(env.TELEGRAM_WEBHOOK_URL + webhookPath);
      const webhookInfo = await container.bot.telegram.getWebhookInfo();
      logger.info({ webhookInfo }, 'Bot started with webhook');
    } else {
      // Long polling: do not await — Telegraf blocks inside startPolling() until the bot stops.
      void container.bot.launch().catch((err) => {
        logger.error({ err }, 'Telegram bot launch failed');
        process.exit(1);
      });
      logger.info('Telegram long polling launch initiated');
    }

    logger.info('VPNoodles bot is running!');
  } catch (error) {
    logger.error({ error }, 'Failed to start bot');
    process.exit(1);
  }
}

bootstrap();
