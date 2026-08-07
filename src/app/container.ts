import { Telegraf } from 'telegraf';
import { getEnv } from '../shared/config/env.js';
import { getLogger } from '../shared/logger/index.js';

// Repositories
import { UserRepository } from '../infrastructure/db/repositories/UserRepository.js';
import { PlanRepository } from '../infrastructure/db/repositories/PlanRepository.js';
import { SubscriptionRepository } from '../infrastructure/db/repositories/SubscriptionRepository.js';
import { PaymentRepository } from '../infrastructure/db/repositories/PaymentRepository.js';
import { AuditLogRepository } from '../infrastructure/db/repositories/AuditLogRepository.js';
import { NotificationLogRepository } from '../infrastructure/db/repositories/NotificationLogRepository.js';
import { ReferralRewardRepository } from '../infrastructure/db/repositories/ReferralRewardRepository.js';
import { ReferralSettingsRepository } from '../infrastructure/db/repositories/ReferralSettingsRepository.js';
import { ServerCostRepository } from '../infrastructure/db/repositories/ServerCostRepository.js';

// Services
import { RemnawaveClient } from '../infrastructure/remnawave/RemnawaveClient.js';
import { RedisCacheService } from '../infrastructure/cache/RedisCacheService.js';
import { PaymentOrchestrator } from '../infrastructure/payments/PaymentOrchestrator.js';
import { QRCodeService } from '../infrastructure/qrcode/QRCodeService.js';
import { NotificationService } from '../infrastructure/notifications/NotificationService.js';
import { DatabaseHealthService } from '../infrastructure/db/DatabaseHealthService.js';

// Use cases
import { RegisterUserUseCase } from '../application/usecases/RegisterUserUseCase.js';
import { ActivateTrialUseCase } from '../application/usecases/ActivateTrialUseCase.js';
import { GetSubscriptionUseCase } from '../application/usecases/GetSubscriptionUseCase.js';
import { PurchasePlanUseCase } from '../application/usecases/PurchasePlanUseCase.js';
import { RenewSubscriptionUseCase } from '../application/usecases/RenewSubscriptionUseCase.js';
import { SyncSubscriptionDevicesUseCase } from '../application/usecases/SyncSubscriptionDevicesUseCase.js';
import { SyncSubscriptionExpiryUseCase } from '../application/usecases/SyncSubscriptionExpiryUseCase.js';
import { GetUserDevicesUseCase } from '../application/usecases/GetUserDevicesUseCase.js';
import { DeleteUserDeviceUseCase } from '../application/usecases/DeleteUserDeviceUseCase.js';
import { SyncAllSubscriptionsFromRemnawaveUseCase } from '../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import { MigrateUsersToRemnawaveUseCase } from '../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import { SendNoSubscriptionRemindersUseCase } from '../application/usecases/SendNoSubscriptionRemindersUseCase.js';
import { SendTrialExpiringRemindersUseCase } from '../application/usecases/SendTrialExpiringRemindersUseCase.js';
import { SendPaidExpiringRemindersUseCase } from '../application/usecases/SendPaidExpiringRemindersUseCase.js';
import { DeactivateBlockedUserUseCase } from '../application/usecases/DeactivateBlockedUserUseCase.js';
import { RestoreBlockedUserUseCase } from '../application/usecases/RestoreBlockedUserUseCase.js';
import { GetAdminOverviewUseCase } from '../application/usecases/GetAdminOverviewUseCase.js';
import { GetUsersGrowthUseCase } from '../application/usecases/GetUsersGrowthUseCase.js';
import { GetSystemHealthUseCase } from '../application/usecases/GetSystemHealthUseCase.js';
import { ListUsersUseCase } from '../application/usecases/ListUsersUseCase.js';
import { GetUserDetailUseCase } from '../application/usecases/GetUserDetailUseCase.js';
import { ListPaymentsUseCase } from '../application/usecases/ListPaymentsUseCase.js';
import { ListNotificationLogsUseCase } from '../application/usecases/ListNotificationLogsUseCase.js';
import { ListAuditLogsUseCase } from '../application/usecases/ListAuditLogsUseCase.js';
import { SendCustomNotificationUseCase } from '../application/usecases/SendCustomNotificationUseCase.js';
import { ReferralSettingsService } from '../application/usecases/referral/ReferralSettingsService.js';
import { ReferralRewardService } from '../application/usecases/referral/ReferralRewardService.js';
import { ClaimPendingReferralRewardsUseCase } from '../application/usecases/referral/ClaimPendingReferralRewardsUseCase.js';
import { GetReferralOverviewUseCase } from '../application/usecases/referral/GetReferralOverviewUseCase.js';
import { GetTopReferrersUseCase } from '../application/usecases/referral/GetTopReferrersUseCase.js';
import { ListReferralRewardsUseCase } from '../application/usecases/referral/ListReferralRewardsUseCase.js';
import { ListServerCostsUseCase } from '../application/usecases/ListServerCostsUseCase.js';
import { UpsertServerCostUseCase } from '../application/usecases/UpsertServerCostUseCase.js';
import { DeleteServerCostUseCase } from '../application/usecases/DeleteServerCostUseCase.js';
import { GetServerCostSummaryUseCase } from '../application/usecases/GetServerCostSummaryUseCase.js';

// Handlers
import { BotHandlers } from '../transport/telegram/handlers.js';

export interface AppContainer {
  // Repositories
  userRepo: UserRepository;
  planRepo: PlanRepository;
  subscriptionRepo: SubscriptionRepository;
  paymentRepo: PaymentRepository;
  auditLogRepo: AuditLogRepository;
  notificationLogRepo: NotificationLogRepository;
  referralRewardRepo: ReferralRewardRepository;
  referralSettingsRepo: ReferralSettingsRepository;
  serverCostRepo: ServerCostRepository;

  // Services
  remnawaveService: RemnawaveClient;
  cacheService: RedisCacheService;
  paymentService: PaymentOrchestrator;
  qrCodeService: QRCodeService;
  notificationService: NotificationService;
  databaseHealthService: DatabaseHealthService;
  referralSettingsService: ReferralSettingsService;
  referralRewardService: ReferralRewardService;

  // Use cases
  registerUserUseCase: RegisterUserUseCase;
  activateTrialUseCase: ActivateTrialUseCase;
  getSubscriptionUseCase: GetSubscriptionUseCase;
  purchasePlanUseCase: PurchasePlanUseCase;
  renewSubscriptionUseCase: RenewSubscriptionUseCase;
  claimPendingReferralRewardsUseCase: ClaimPendingReferralRewardsUseCase;
  sendNoSubscriptionRemindersUseCase: SendNoSubscriptionRemindersUseCase;
  sendTrialExpiringRemindersUseCase: SendTrialExpiringRemindersUseCase;
  sendPaidExpiringRemindersUseCase: SendPaidExpiringRemindersUseCase;
  getAdminOverviewUseCase: GetAdminOverviewUseCase;
  getUsersGrowthUseCase: GetUsersGrowthUseCase;
  getSystemHealthUseCase: GetSystemHealthUseCase;
  listUsersUseCase: ListUsersUseCase;
  getUserDetailUseCase: GetUserDetailUseCase;
  listPaymentsUseCase: ListPaymentsUseCase;
  listNotificationLogsUseCase: ListNotificationLogsUseCase;
  listAuditLogsUseCase: ListAuditLogsUseCase;
  sendCustomNotificationUseCase: SendCustomNotificationUseCase;
  getReferralOverviewUseCase: GetReferralOverviewUseCase;
  getTopReferrersUseCase: GetTopReferrersUseCase;
  listReferralRewardsUseCase: ListReferralRewardsUseCase;
  listServerCostsUseCase: ListServerCostsUseCase;
  upsertServerCostUseCase: UpsertServerCostUseCase;
  deleteServerCostUseCase: DeleteServerCostUseCase;
  getServerCostSummaryUseCase: GetServerCostSummaryUseCase;

  // Bot
  bot: Telegraf;
  handlers: BotHandlers;
}

export function createContainer(): AppContainer {
  const env = getEnv();
  const logger = getLogger();

  // Bot
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  // Repositories
  const userRepo = new UserRepository();
  const planRepo = new PlanRepository();
  const subscriptionRepo = new SubscriptionRepository();
  const paymentRepo = new PaymentRepository();
  const auditLogRepo = new AuditLogRepository();
  const notificationLogRepo = new NotificationLogRepository();
  const referralRewardRepo = new ReferralRewardRepository();
  const referralSettingsRepo = new ReferralSettingsRepository();
  const serverCostRepo = new ServerCostRepository();

  // Services
  const cacheService = new RedisCacheService();
  const remnawaveService = new RemnawaveClient(cacheService);
  const paymentService = new PaymentOrchestrator(paymentRepo, cacheService);
  const qrCodeService = new QRCodeService();
  const databaseHealthService = new DatabaseHealthService();
  const referralSettingsService = new ReferralSettingsService(referralSettingsRepo, cacheService);

  const deactivateBlockedUserUseCase = new DeactivateBlockedUserUseCase(
    userRepo,
    subscriptionRepo,
    auditLogRepo,
    remnawaveService,
  );
  const restoreBlockedUserUseCase = new RestoreBlockedUserUseCase(
    userRepo,
    subscriptionRepo,
    auditLogRepo,
    remnawaveService,
  );

  const notificationService = new NotificationService(
    bot,
    notificationLogRepo,
    deactivateBlockedUserUseCase,
  );

  const syncSubscriptionDevicesUseCase = new SyncSubscriptionDevicesUseCase(
    subscriptionRepo,
    remnawaveService,
  );
  const syncSubscriptionExpiryUseCase = new SyncSubscriptionExpiryUseCase(
    subscriptionRepo,
    remnawaveService,
  );

  // Use cases
  const renewSubscriptionUseCase = new RenewSubscriptionUseCase(
    subscriptionRepo,
    planRepo,
    auditLogRepo,
    remnawaveService,
    syncSubscriptionExpiryUseCase,
  );
  const referralRewardService = new ReferralRewardService(
    userRepo,
    subscriptionRepo,
    planRepo,
    referralRewardRepo,
    referralSettingsService,
    remnawaveService,
    renewSubscriptionUseCase,
    notificationService,
  );
  const claimPendingReferralRewardsUseCase = new ClaimPendingReferralRewardsUseCase(
    referralRewardRepo,
    renewSubscriptionUseCase,
    referralSettingsService,
  );

  const registerUserUseCase = new RegisterUserUseCase(userRepo, auditLogRepo, referralSettingsService);
  const activateTrialUseCase = new ActivateTrialUseCase(
    userRepo,
    planRepo,
    subscriptionRepo,
    auditLogRepo,
    remnawaveService,
    syncSubscriptionDevicesUseCase,
    referralRewardService,
    claimPendingReferralRewardsUseCase,
  );
  const getSubscriptionUseCase = new GetSubscriptionUseCase(
    subscriptionRepo,
    planRepo,
    syncSubscriptionDevicesUseCase,
    syncSubscriptionExpiryUseCase,
  );
  const purchasePlanUseCase = new PurchasePlanUseCase(
    userRepo,
    planRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    remnawaveService,
    paymentService,
    qrCodeService,
    syncSubscriptionDevicesUseCase,
    referralRewardService,
    claimPendingReferralRewardsUseCase,
  );
  const getUserDevicesUseCase = new GetUserDevicesUseCase(subscriptionRepo, remnawaveService);
  const deleteUserDeviceUseCase = new DeleteUserDeviceUseCase(
    subscriptionRepo,
    remnawaveService,
    syncSubscriptionDevicesUseCase,
  );
  const syncAllSubscriptionsFromRemnawaveUseCase = new SyncAllSubscriptionsFromRemnawaveUseCase(
    subscriptionRepo,
    remnawaveService,
    syncSubscriptionExpiryUseCase,
    syncSubscriptionDevicesUseCase,
  );
  const migrateUsersToRemnawaveUseCase = new MigrateUsersToRemnawaveUseCase(
    subscriptionRepo,
    userRepo,
    planRepo,
    remnawaveService,
  );
  const sendNoSubscriptionRemindersUseCase = new SendNoSubscriptionRemindersUseCase(
    userRepo,
    subscriptionRepo,
    notificationLogRepo,
    notificationService,
  );
  const sendTrialExpiringRemindersUseCase = new SendTrialExpiringRemindersUseCase(
    subscriptionRepo,
    notificationLogRepo,
    notificationService,
    syncSubscriptionExpiryUseCase,
  );
  const sendPaidExpiringRemindersUseCase = new SendPaidExpiringRemindersUseCase(
    subscriptionRepo,
    notificationLogRepo,
    notificationService,
    syncSubscriptionExpiryUseCase,
  );

  const getAdminOverviewUseCase = new GetAdminOverviewUseCase(
    userRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    notificationLogRepo,
  );
  const getUsersGrowthUseCase = new GetUsersGrowthUseCase(userRepo);
  const getSystemHealthUseCase = new GetSystemHealthUseCase(
    bot,
    cacheService,
    remnawaveService,
    databaseHealthService,
  );
  const listUsersUseCase = new ListUsersUseCase(userRepo);
  const getUserDetailUseCase = new GetUserDetailUseCase(
    userRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    referralRewardRepo,
  );
  const listPaymentsUseCase = new ListPaymentsUseCase(paymentRepo);
  const listNotificationLogsUseCase = new ListNotificationLogsUseCase(notificationLogRepo, userRepo);
  const listAuditLogsUseCase = new ListAuditLogsUseCase(auditLogRepo, userRepo);
  const sendCustomNotificationUseCase = new SendCustomNotificationUseCase(
    bot,
    userRepo,
    auditLogRepo,
    deactivateBlockedUserUseCase,
    cacheService,
    subscriptionRepo,
    renewSubscriptionUseCase,
    remnawaveService,
    planRepo,
  );
  const getReferralOverviewUseCase = new GetReferralOverviewUseCase(referralRewardRepo);
  const getTopReferrersUseCase = new GetTopReferrersUseCase(referralRewardRepo, userRepo);
  const listReferralRewardsUseCase = new ListReferralRewardsUseCase(referralRewardRepo, userRepo);
  const listServerCostsUseCase = new ListServerCostsUseCase(serverCostRepo);
  const upsertServerCostUseCase = new UpsertServerCostUseCase(serverCostRepo);
  const deleteServerCostUseCase = new DeleteServerCostUseCase(serverCostRepo);
  const getServerCostSummaryUseCase = new GetServerCostSummaryUseCase(serverCostRepo, paymentRepo);

  // Handlers
  const handlers = new BotHandlers(
    bot,
    registerUserUseCase,
    activateTrialUseCase,
    getSubscriptionUseCase,
    purchasePlanUseCase,
    renewSubscriptionUseCase,
    getUserDevicesUseCase,
    deleteUserDeviceUseCase,
    userRepo,
    planRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    qrCodeService,
    paymentService,
    remnawaveService,
    syncAllSubscriptionsFromRemnawaveUseCase,
    migrateUsersToRemnawaveUseCase,
    notificationLogRepo,
    deactivateBlockedUserUseCase,
    restoreBlockedUserUseCase,
    getAdminOverviewUseCase,
    referralRewardRepo,
    referralSettingsService,
  );

  logger.info('Container initialized');

  return {
    userRepo,
    planRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    notificationLogRepo,
    referralRewardRepo,
    referralSettingsRepo,
    serverCostRepo,
    remnawaveService,
    cacheService,
    paymentService,
    qrCodeService,
    notificationService,
    databaseHealthService,
    referralSettingsService,
    referralRewardService,
    registerUserUseCase,
    activateTrialUseCase,
    getSubscriptionUseCase,
    purchasePlanUseCase,
    renewSubscriptionUseCase,
    claimPendingReferralRewardsUseCase,
    sendNoSubscriptionRemindersUseCase,
    sendTrialExpiringRemindersUseCase,
    sendPaidExpiringRemindersUseCase,
    getAdminOverviewUseCase,
    getUsersGrowthUseCase,
    getSystemHealthUseCase,
    listUsersUseCase,
    getUserDetailUseCase,
    listPaymentsUseCase,
    listNotificationLogsUseCase,
    listAuditLogsUseCase,
    sendCustomNotificationUseCase,
    getReferralOverviewUseCase,
    getTopReferrersUseCase,
    listReferralRewardsUseCase,
    listServerCostsUseCase,
    upsertServerCostUseCase,
    deleteServerCostUseCase,
    getServerCostSummaryUseCase,
    bot,
    handlers,
  };
}
