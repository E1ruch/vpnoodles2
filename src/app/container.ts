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

// Services
import { RemnawaveClient } from '../infrastructure/remnawave/RemnawaveClient.js';
import { RedisCacheService } from '../infrastructure/cache/RedisCacheService.js';
import { PaymentOrchestrator } from '../infrastructure/payments/PaymentOrchestrator.js';
import { QRCodeService } from '../infrastructure/qrcode/QRCodeService.js';
import { NotificationService } from '../infrastructure/notifications/NotificationService.js';

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
import { ListUsersUseCase } from '../application/usecases/ListUsersUseCase.js';
import { GetUserDetailUseCase } from '../application/usecases/GetUserDetailUseCase.js';
import { ListPaymentsUseCase } from '../application/usecases/ListPaymentsUseCase.js';
import { ListNotificationLogsUseCase } from '../application/usecases/ListNotificationLogsUseCase.js';
import { ListAuditLogsUseCase } from '../application/usecases/ListAuditLogsUseCase.js';
import { SendCustomNotificationUseCase } from '../application/usecases/SendCustomNotificationUseCase.js';

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

  // Services
  remnawaveService: RemnawaveClient;
  cacheService: RedisCacheService;
  paymentService: PaymentOrchestrator;
  qrCodeService: QRCodeService;
  notificationService: NotificationService;

  // Use cases
  registerUserUseCase: RegisterUserUseCase;
  activateTrialUseCase: ActivateTrialUseCase;
  getSubscriptionUseCase: GetSubscriptionUseCase;
  purchasePlanUseCase: PurchasePlanUseCase;
  renewSubscriptionUseCase: RenewSubscriptionUseCase;
  sendNoSubscriptionRemindersUseCase: SendNoSubscriptionRemindersUseCase;
  sendTrialExpiringRemindersUseCase: SendTrialExpiringRemindersUseCase;
  sendPaidExpiringRemindersUseCase: SendPaidExpiringRemindersUseCase;
  getAdminOverviewUseCase: GetAdminOverviewUseCase;
  listUsersUseCase: ListUsersUseCase;
  getUserDetailUseCase: GetUserDetailUseCase;
  listPaymentsUseCase: ListPaymentsUseCase;
  listNotificationLogsUseCase: ListNotificationLogsUseCase;
  listAuditLogsUseCase: ListAuditLogsUseCase;
  sendCustomNotificationUseCase: SendCustomNotificationUseCase;

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

  // Services
  const cacheService = new RedisCacheService();
  const remnawaveService = new RemnawaveClient(cacheService);
  const paymentService = new PaymentOrchestrator(paymentRepo, cacheService);
  const qrCodeService = new QRCodeService();

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
  const registerUserUseCase = new RegisterUserUseCase(userRepo, auditLogRepo);
  const activateTrialUseCase = new ActivateTrialUseCase(
    userRepo,
    planRepo,
    subscriptionRepo,
    auditLogRepo,
    remnawaveService,
    syncSubscriptionDevicesUseCase,
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
  );
  const renewSubscriptionUseCase = new RenewSubscriptionUseCase(
    subscriptionRepo,
    planRepo,
    auditLogRepo,
    remnawaveService,
    syncSubscriptionExpiryUseCase,
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
  const listUsersUseCase = new ListUsersUseCase(userRepo);
  const getUserDetailUseCase = new GetUserDetailUseCase(userRepo, subscriptionRepo, paymentRepo, auditLogRepo);
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
  );

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
  );

  logger.info('Container initialized');

  return {
    userRepo,
    planRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    notificationLogRepo,
    remnawaveService,
    cacheService,
    paymentService,
    qrCodeService,
    notificationService,
    registerUserUseCase,
    activateTrialUseCase,
    getSubscriptionUseCase,
    purchasePlanUseCase,
    renewSubscriptionUseCase,
    sendNoSubscriptionRemindersUseCase,
    sendTrialExpiringRemindersUseCase,
    sendPaidExpiringRemindersUseCase,
    getAdminOverviewUseCase,
    listUsersUseCase,
    getUserDetailUseCase,
    listPaymentsUseCase,
    listNotificationLogsUseCase,
    listAuditLogsUseCase,
    sendCustomNotificationUseCase,
    bot,
    handlers,
  };
}
