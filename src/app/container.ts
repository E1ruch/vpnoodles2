import { Telegraf } from 'telegraf';
import { getEnv } from '../shared/config/env.js';
import { getLogger } from '../shared/logger/index.js';

// Repositories
import { UserRepository } from '../infrastructure/db/repositories/UserRepository.js';
import { PlanRepository } from '../infrastructure/db/repositories/PlanRepository.js';
import { SubscriptionRepository } from '../infrastructure/db/repositories/SubscriptionRepository.js';
import { PaymentRepository } from '../infrastructure/db/repositories/PaymentRepository.js';
import { AuditLogRepository } from '../infrastructure/db/repositories/AuditLogRepository.js';

// Services
import { RemnawaveClient } from '../infrastructure/remnawave/RemnawaveClient.js';
import { RedisCacheService } from '../infrastructure/cache/RedisCacheService.js';
import { PaymentOrchestrator } from '../infrastructure/payments/PaymentOrchestrator.js';
import { QRCodeService } from '../infrastructure/qrcode/QRCodeService.js';

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

// Handlers
import { BotHandlers } from '../transport/telegram/handlers.js';

export interface AppContainer {
  // Repositories
  userRepo: UserRepository;
  planRepo: PlanRepository;
  subscriptionRepo: SubscriptionRepository;
  paymentRepo: PaymentRepository;
  auditLogRepo: AuditLogRepository;

  // Services
  remnawaveService: RemnawaveClient;
  cacheService: RedisCacheService;
  paymentService: PaymentOrchestrator;
  qrCodeService: QRCodeService;

  // Use cases
  registerUserUseCase: RegisterUserUseCase;
  activateTrialUseCase: ActivateTrialUseCase;
  getSubscriptionUseCase: GetSubscriptionUseCase;
  purchasePlanUseCase: PurchasePlanUseCase;
  renewSubscriptionUseCase: RenewSubscriptionUseCase;

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

  // Services
  const remnawaveService = new RemnawaveClient();
  const cacheService = new RedisCacheService();
  const paymentService = new PaymentOrchestrator(paymentRepo, cacheService);
  const qrCodeService = new QRCodeService();

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
  );

  logger.info('Container initialized');

  return {
    userRepo,
    planRepo,
    subscriptionRepo,
    paymentRepo,
    auditLogRepo,
    remnawaveService,
    cacheService,
    paymentService,
    qrCodeService,
    registerUserUseCase,
    activateTrialUseCase,
    getSubscriptionUseCase,
    purchasePlanUseCase,
    renewSubscriptionUseCase,
    bot,
    handlers,
  };
}
