import 'reflect-metadata';
import 'dotenv/config';
import { getDataSource } from './src/infrastructure/db/connection.js';
import { createContainer } from './src/app/container.js';
import { createAdminHttpApp } from './src/transport/http/server.js';
import { getLogger } from './src/shared/logger/index.js';

const PORT = Number(process.env['ADMIN_ONLY_PORT'] ?? 3002);

async function main() {
  const logger = getLogger();
  await getDataSource();

  const container = createContainer();
  // Намеренно НЕ вызываем container.handlers.register() и container.bot.launch()/webhook —
  // бот остаётся полностью пассивным (только HTTP-клиент для getMe() в /api/auth/config).

  const app = createAdminHttpApp({
    bot: container.bot,
    cacheService: container.cacheService,
    remnawaveService: container.remnawaveService,
    getAdminOverviewUseCase: container.getAdminOverviewUseCase,
    getUsersGrowthUseCase: container.getUsersGrowthUseCase,
    getSystemHealthUseCase: container.getSystemHealthUseCase,
    listUsersUseCase: container.listUsersUseCase,
    getUserDetailUseCase: container.getUserDetailUseCase,
    listPaymentsUseCase: container.listPaymentsUseCase,
    listNotificationLogsUseCase: container.listNotificationLogsUseCase,
    listAuditLogsUseCase: container.listAuditLogsUseCase,
    sendCustomNotificationUseCase: container.sendCustomNotificationUseCase,
    getReferralOverviewUseCase: container.getReferralOverviewUseCase,
    getTopReferrersUseCase: container.getTopReferrersUseCase,
    listReferralRewardsUseCase: container.listReferralRewardsUseCase,
    referralSettingsService: container.referralSettingsService,
    listServerCostsUseCase: container.listServerCostsUseCase,
    upsertServerCostUseCase: container.upsertServerCostUseCase,
    deleteServerCostUseCase: container.deleteServerCostUseCase,
    getServerCostSummaryUseCase: container.getServerCostSummaryUseCase,
    listPlansUseCase: container.listPlansUseCase,
    createPlanUseCase: container.createPlanUseCase,
    updatePlanUseCase: container.updatePlanUseCase,
    deletePlanUseCase: container.deletePlanUseCase,
  });

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Admin-only HTTP server started (Telegram bot NOT launched, real DB)');
    // eslint-disable-next-line no-console
    console.log(`\nOpen: http://localhost:${PORT}/plans\n`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
