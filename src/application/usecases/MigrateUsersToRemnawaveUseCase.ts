import type {
  IPlanRepository,
  ISubscriptionRepository,
  IUserRepository,
} from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { Subscription } from '../../domain/entities/Subscription.js';
import { getEnv } from '../../shared/config/env.js';
import { getLogger } from '../../shared/logger/index.js';
import { RemnawaveError } from '../../shared/errors/index.js';

export interface MigratedUserPayload {
  userId: string;
  telegramId: number;
  subscriptionId: string;
  subscriptionUrl: string;
}

export interface MigrateUsersToRemnawaveResult {
  totalUsers: number;
  migratedUsers: number;
  failedUsers: number;
  skippedUsers: number;
  recipients: MigratedUserPayload[];
}

export class MigrateUsersToRemnawaveUseCase {
  static readonly MIGRATION_BONUS_DAYS = 5;

  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(): Promise<MigrateUsersToRemnawaveResult> {
    const logger = getLogger();
    const env = getEnv();
    const subscriptions = await this.subscriptionRepo.findAll();
    const grouped = this.groupByUserId(subscriptions);
    const recipients: MigratedUserPayload[] = [];
    const squads = env.REMNAWAVE_DEFAULT_SQUAD ? [env.REMNAWAVE_DEFAULT_SQUAD] : [];
    const now = Date.now();

    let migratedUsers = 0;
    let failedUsers = 0;
    let skippedUsers = 0;

    for (const [userId, userSubscriptions] of grouped) {
      try {
        const sourceSubscription = this.pickActualSubscription(userSubscriptions);
        if (!sourceSubscription) {
          skippedUsers++;
          continue;
        }

        const user = sourceSubscription.user ?? (await this.userRepo.findById(userId));
        const plan = sourceSubscription.plan ?? (await this.planRepo.findById(sourceSubscription.planId));
        if (!user || !plan) {
          skippedUsers++;
          continue;
        }

        const tag = plan.remnawaveTag ?? (plan.type === 'trial' ? 'TRIAL' : 'PAID');
        const migratedExpireAt = this.applyMigrationBonus(sourceSubscription.endDate, now);

        let remnawaveUserId = sourceSubscription.remnawaveUserId;
        const username = user.username ?? `user_${user.telegramId}`;

        if (!remnawaveUserId) {
          remnawaveUserId = await this.remnawaveService.createUser(
            user.telegramId,
            username,
            tag,
            squads,
            {
              deviceLimit: sourceSubscription.deviceLimit,
              trafficLimitBytes: 0,
              trafficLimitStrategy: 'NO_RESET',
              expireAt: migratedExpireAt,
            },
          );
        }

        try {
          await this.remnawaveService.upgradeUser(remnawaveUserId, {
            tag,
            deviceLimit: sourceSubscription.deviceLimit,
            trafficLimitBytes: 0,
            trafficLimitStrategy: 'NO_RESET',
            expireAt: migratedExpireAt,
          });
        } catch (error) {
          // В БД может быть устаревший remnawaveUserId после потери старой панели.
          if (remnawaveUserId && this.isNotFoundError(error)) {
            logger.warn(
              { userId, remnawaveUserId },
              'Stale remnawaveUserId detected, recreating user by telegram username',
            );
            remnawaveUserId = await this.remnawaveService.createUser(
              user.telegramId,
              username,
              tag,
              squads,
              {
                deviceLimit: sourceSubscription.deviceLimit,
                trafficLimitBytes: 0,
                trafficLimitStrategy: 'NO_RESET',
                expireAt: migratedExpireAt,
              },
            );
            await this.remnawaveService.upgradeUser(remnawaveUserId, {
              tag,
              deviceLimit: sourceSubscription.deviceLimit,
              trafficLimitBytes: 0,
              trafficLimitStrategy: 'NO_RESET',
              expireAt: migratedExpireAt,
            });
          } else {
            throw error;
          }
        }

        await this.remnawaveService.resumeUser(remnawaveUserId);

        const subscriptionUrl = await this.remnawaveService.getSubscriptionUrl(remnawaveUserId);
        await this.subscriptionRepo.update(sourceSubscription.id, {
          remnawaveUserId,
          subscriptionUrl,
          endDate: migratedExpireAt,
          status: 'active',
        });

        recipients.push({
          userId,
          telegramId: Number(user.telegramId),
          subscriptionId: sourceSubscription.id,
          subscriptionUrl,
        });
        migratedUsers++;
      } catch (error) {
        failedUsers++;
        logger.warn({ error, userId }, 'User migration to Remnawave failed');
      }
    }

    logger.info(
      {
        totalUsers: grouped.size,
        migratedUsers,
        failedUsers,
        skippedUsers,
        bonusDays: MigrateUsersToRemnawaveUseCase.MIGRATION_BONUS_DAYS,
      },
      'Users migration to Remnawave completed',
    );

    return {
      totalUsers: grouped.size,
      migratedUsers,
      failedUsers,
      skippedUsers,
      recipients,
    };
  }

  private groupByUserId(subscriptions: Subscription[]): Map<string, Subscription[]> {
    const groups = new Map<string, Subscription[]>();
    for (const sub of subscriptions) {
      const list = groups.get(sub.userId) ?? [];
      list.push(sub);
      groups.set(sub.userId, list);
    }
    return groups;
  }

  private pickActualSubscription(subscriptions: Subscription[]): Subscription | null {
    if (subscriptions.length === 0) return null;
    const active = subscriptions
      .filter((sub) => sub.status === 'active')
      .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0];
    if (active) return active;
    return subscriptions.sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? null;
  }

  private isNotFoundError(error: unknown): boolean {
    if (error instanceof RemnawaveError) {
      return error.message.includes('404');
    }
    if (error instanceof Error) {
      return error.message.includes('404');
    }
    return false;
  }

  /** +5 дней всем: к текущей дате окончания или от «сейчас», если подписка уже истекла. */
  private applyMigrationBonus(sourceEndDate: Date, nowTs: number): Date {
    const bonusMs = MigrateUsersToRemnawaveUseCase.MIGRATION_BONUS_DAYS * 24 * 60 * 60 * 1000;
    const baseTs = Math.max(sourceEndDate.getTime(), nowTs);
    return new Date(baseTs + bonusMs);
  }
}
