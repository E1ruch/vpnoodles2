import { Telegraf } from 'telegraf';
import type {
  IUserRepository,
  IPlanRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
  INotificationLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import type { RenewSubscriptionUseCase } from '../../../application/usecases/RenewSubscriptionUseCase.js';
import type { SyncAllSubscriptionsFromRemnawaveUseCase } from '../../../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import { MigrateUsersToRemnawaveUseCase } from '../../../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import type { DeactivateBlockedUserUseCase } from '../../../application/usecases/DeactivateBlockedUserUseCase.js';
import type { GetAdminOverviewUseCase } from '../../../application/usecases/GetAdminOverviewUseCase.js';
import { AdminOverviewHandlers } from './AdminOverviewHandlers.js';
import { AdminListHandlers } from './AdminListHandlers.js';
import { AdminMigrationHandlers } from './AdminMigrationHandlers.js';
import { AdminBroadcastHandlers } from './AdminBroadcastHandlers.js';

/**
 * Композиционный корень админ-панели. Раньше все обработчики (меню/статистика,
 * пагинированные списки, синхронизация/миграция, рассылки) жили в этом одном
 * классе — файл разросся до ~920 строк. Разбит на модули по доменным группам
 * (тот же паттерн, что уже применялся к handlers.ts → user/*Handlers): общая
 * инфраструктура (isAdmin, safeEditMessageText, пагинация, форматирование) —
 * в adminShared.ts, остальное — по группам.
 */
export class AdminHandlers {
  private overviewHandlers: AdminOverviewHandlers;
  private listHandlers: AdminListHandlers;
  private migrationHandlers: AdminMigrationHandlers;
  private broadcastHandlers: AdminBroadcastHandlers;

  constructor(
    bot: Telegraf,
    userRepo: IUserRepository,
    planRepo: IPlanRepository,
    subscriptionRepo: ISubscriptionRepository,
    paymentRepo: IPaymentRepository,
    auditLogRepo: IAuditLogRepository,
    remnawaveService: IRemnawaveService,
    renewSubscription: RenewSubscriptionUseCase,
    syncAllFromRemnawave: SyncAllSubscriptionsFromRemnawaveUseCase,
    migrateUsersToRemnawave: MigrateUsersToRemnawaveUseCase,
    notificationLogRepo: INotificationLogRepository,
    deactivateBlockedUser: DeactivateBlockedUserUseCase,
    getAdminOverview: GetAdminOverviewUseCase,
  ) {
    // Общий Set: открытие главного меню (AdminOverviewHandlers) сбрасывает
    // ожидание текста рассылки (AdminBroadcastHandlers), поэтому оба класса
    // держат ссылку на один и тот же объект, а не копию.
    const pendingCustomBroadcast = new Set<number>();

    this.overviewHandlers = new AdminOverviewHandlers(
      paymentRepo,
      remnawaveService,
      pendingCustomBroadcast,
      getAdminOverview,
    );

    this.listHandlers = new AdminListHandlers(
      userRepo,
      planRepo,
      subscriptionRepo,
      auditLogRepo,
      notificationLogRepo,
    );

    this.migrationHandlers = new AdminMigrationHandlers(
      bot,
      userRepo,
      subscriptionRepo,
      auditLogRepo,
      syncAllFromRemnawave,
      migrateUsersToRemnawave,
      deactivateBlockedUser,
    );

    this.broadcastHandlers = new AdminBroadcastHandlers(
      bot,
      userRepo,
      subscriptionRepo,
      auditLogRepo,
      renewSubscription,
      deactivateBlockedUser,
      pendingCustomBroadcast,
    );
  }

  register(bot: Telegraf): void {
    this.overviewHandlers.register(bot);
    this.listHandlers.register(bot);
    this.migrationHandlers.register(bot);
    this.broadcastHandlers.register(bot);
  }
}
