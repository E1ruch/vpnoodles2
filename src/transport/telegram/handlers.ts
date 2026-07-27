import { Context, Telegraf } from 'telegraf';
import type { RegisterUserUseCase } from '../../application/usecases/RegisterUserUseCase.js';
import type { ActivateTrialUseCase } from '../../application/usecases/ActivateTrialUseCase.js';
import type { GetSubscriptionUseCase } from '../../application/usecases/GetSubscriptionUseCase.js';
import type { PurchasePlanUseCase } from '../../application/usecases/PurchasePlanUseCase.js';
import type { RenewSubscriptionUseCase } from '../../application/usecases/RenewSubscriptionUseCase.js';
import type { GetUserDevicesUseCase } from '../../application/usecases/GetUserDevicesUseCase.js';
import type { DeleteUserDeviceUseCase } from '../../application/usecases/DeleteUserDeviceUseCase.js';
import type { SyncAllSubscriptionsFromRemnawaveUseCase } from '../../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import type { MigrateUsersToRemnawaveUseCase } from '../../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type {
  IQRCodeService,
  IPaymentService,
  IRemnawaveService,
} from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';
import { formatDate } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';
import { Texts } from './texts.js';
import { mainMenuKeyboard, planSelectionKeyboard, backToMainKeyboard, profileKeyboard } from './keyboards.js';
import { AdminHandlers } from './admin/AdminHandlers.js';
import { DeviceHandlers } from './user/DeviceHandlers.js';
import { PaymentHandlers } from './user/PaymentHandlers.js';
import { SubscriptionHandlers } from './user/SubscriptionHandlers.js';

/**
 * Композиционный корень бота. Раньше все обработчики (меню, тарифы, оплата,
 * устройства) жили в этом одном классе — файл разросся до ~1150 строк. Разбит
 * на модули по доменным группам (тот же паттерн, что уже применялся к
 * AdminHandlers): DeviceHandlers, PaymentHandlers, SubscriptionHandlers.
 * Здесь остаётся только базовая навигация (start/back/profile/support) и
 * регистрация всех групп обработчиков. Публичный конструктор и register()
 * не менялись — container.ts трогать не пришлось.
 */
export class BotHandlers {
  private bot: Telegraf;
  private registerUser: RegisterUserUseCase;
  private getSubscription: GetSubscriptionUseCase;
  private userRepo: IUserRepository;
  private adminHandlers: AdminHandlers;
  private deviceHandlers: DeviceHandlers;
  private paymentHandlers: PaymentHandlers;
  private subscriptionHandlers: SubscriptionHandlers;

  constructor(
    bot: Telegraf,
    registerUser: RegisterUserUseCase,
    activateTrial: ActivateTrialUseCase,
    getSubscription: GetSubscriptionUseCase,
    purchasePlan: PurchasePlanUseCase,
    renewSubscription: RenewSubscriptionUseCase,
    getUserDevices: GetUserDevicesUseCase,
    deleteUserDevice: DeleteUserDeviceUseCase,
    userRepo: IUserRepository,
    planRepo: IPlanRepository,
    subscriptionRepo: ISubscriptionRepository,
    paymentRepo: IPaymentRepository,
    auditLogRepo: IAuditLogRepository,
    qrCodeService: IQRCodeService,
    paymentService: IPaymentService,
    remnawaveService: IRemnawaveService,
    syncAllFromRemnawave: SyncAllSubscriptionsFromRemnawaveUseCase,
    migrateUsersToRemnawave: MigrateUsersToRemnawaveUseCase,
    notificationLogRepo: INotificationLogRepository,
  ) {
    this.bot = bot;
    this.registerUser = registerUser;
    this.getSubscription = getSubscription;
    this.userRepo = userRepo;

    this.deviceHandlers = new DeviceHandlers(userRepo, getUserDevices, deleteUserDevice);

    this.paymentHandlers = new PaymentHandlers(
      bot,
      userRepo,
      planRepo,
      paymentRepo,
      auditLogRepo,
      qrCodeService,
      paymentService,
      purchasePlan,
    );

    this.subscriptionHandlers = new SubscriptionHandlers(
      userRepo,
      planRepo,
      subscriptionRepo,
      getSubscription,
      activateTrial,
      renewSubscription,
      qrCodeService,
    );

    this.adminHandlers = new AdminHandlers(
      bot,
      userRepo,
      planRepo,
      subscriptionRepo,
      paymentRepo,
      auditLogRepo,
      remnawaveService,
      renewSubscription,
      syncAllFromRemnawave,
      migrateUsersToRemnawave,
      notificationLogRepo,
    );
  }

  register(): void {
    this.bot.start(this.handleStart);
    this.bot.action('back_main', this.handleBackMain);
    this.bot.action('profile', this.handleProfile);
    this.bot.action('support', this.handleSupport);

    this.deviceHandlers.register(this.bot);
    this.paymentHandlers.register(this.bot);
    this.subscriptionHandlers.register(this.bot);
    this.adminHandlers.register(this.bot);

    // Global error handler
    this.bot.catch((err) => {
      const logger = getLogger();
      logger.error({ err }, 'Bot error');
    });
  }

  private handleStart = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const userId = await this.registerUser.execute(
        telegramUser.id,
        telegramUser.username ?? null,
        telegramUser.first_name ?? null,
      );

      const user = await this.userRepo.findById(userId);

      const sub = await this.getSubscription.execute(userId);

      const firstName = user?.firstName ?? telegramUser.first_name ?? 'Пользователь';

      if (sub) {
        const welcomeText = Texts.WELCOME_BACK_NAME.replace('{firstName}', firstName);
        await ctx.reply(welcomeText, { reply_markup: mainMenuKeyboard() });
      } else {
        const welcomeText = Texts.WELCOME.replace('{firstName}', firstName);
        await ctx.reply(welcomeText, { reply_markup: planSelectionKeyboard() });
      }
    } catch (err) {
      logger.error({ err }, 'Error in /start handler');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleBackMain = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const firstName = user.firstName ?? telegramUser.first_name ?? 'Пользователь';
      const welcomeText = Texts.WELCOME_BACK_NAME.replace('{firstName}', firstName);

      await ctx.editMessageText(welcomeText, {
        reply_markup: mainMenuKeyboard(),
      });
    } catch {
      await ctx.reply(Texts.WELCOME_BACK, { reply_markup: mainMenuKeyboard() });
    }
  };

  private handleProfile = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const sub = await this.getSubscription.execute(user.id);
      const status = sub ? (sub.isExpired ? 'Не активно' : 'Активно') : 'Нет подписки';
      const devicesLine = sub
        ? Texts.PROFILE_DEVICES_LINE.replace('{usedDevices}', String(sub.usedDevices)).replace(
            '{deviceLimit}',
            String(sub.deviceLimit),
          )
        : '';

      const text = Texts.PROFILE.replace('{telegramId}', String(user.telegramId))
        .replace('{firstName}', user.firstName ?? 'Не указано')
        .replace('{status}', status)
        .replace('{regDate}', formatDate(user.createdAt))
        .replace('{devicesLine}', devicesLine);

      await ctx.editMessageText(text, {
        reply_markup: profileKeyboard(),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleSupport = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    try {
      await ctx.editMessageText(Texts.SUPPORT.replace('{supportUsername}', env.SUPPORT_USERNAME), {
        reply_markup: backToMainKeyboard(),
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };
}
