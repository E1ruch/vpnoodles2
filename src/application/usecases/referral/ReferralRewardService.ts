import type {
  IUserRepository,
  ISubscriptionRepository,
  IPlanRepository,
  IReferralRewardRepository,
} from '../../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import type { User } from '../../../domain/entities/User.js';
import type { ReferralReward, ReferralRewardType } from '../../../domain/entities/ReferralReward.js';
import type { ReferralSettings } from '../../../domain/entities/ReferralSettings.js';
import type { RenewSubscriptionUseCase } from '../RenewSubscriptionUseCase.js';
import type { NotificationService } from '../../../infrastructure/notifications/NotificationService.js';
import { ReferralSettingsService } from './ReferralSettingsService.js';
import { Texts } from '../../../transport/telegram/texts.js';
import { getLogger } from '../../../shared/logger/index.js';

const GB_IN_BYTES = 1024 * 1024 * 1024;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === POSTGRES_UNIQUE_VIOLATION;
}

interface RewardTarget {
  referrerUserId: string;
  referredUserId: string;
  rewardType: ReferralRewardType;
  level: number;
  triggerPaymentId?: string | null;
  milestoneThreshold?: number | null;
}

/**
 * Реализует §2 плана (docs/referral-program-plan.md): начисление/банковка всех типов
 * реферальных наград поверх уже существующих RenewSubscriptionUseCase / RemnawaveClient,
 * без параллельного механизма зачисления. Идемпотентность обеспечивается тем, что строка
 * ReferralReward создаётся (и тем самым "бронирует" уникальный слот через DB-констрейнт,
 * см. ReferralReward.ts) ДО того, как применяется сама мутация (extendUser/updateTrafficLimit) —
 * а не после, иначе повторная попытка после сбоя INSERT могла бы задвоить уже применённое
 * начисление (тот же класс гонки, что описан в CLAUDE.md про PurchasePlanUseCase).
 */
export class ReferralRewardService {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private planRepo: IPlanRepository,
    private rewardRepo: IReferralRewardRepository,
    private settingsService: ReferralSettingsService,
    private remnawaveService: IRemnawaveService,
    private renewSubscriptionUseCase: RenewSubscriptionUseCase,
    private notificationService: NotificationService,
  ) {}

  // ---- §2.1: бонус самому приглашённому за переход по ссылке ----

  async getReferredSignupPerkAdjustment(
    referredByUserId: string | null,
  ): Promise<{ extraDays: number; extraTrafficGb: number } | null> {
    if (!referredByUserId) return null;
    const settings = await this.settingsService.get();
    if (!settings.enabled) return null;

    if (settings.referredSignupBonusType === 'days') {
      return { extraDays: settings.referredSignupBonusDays, extraTrafficGb: 0 };
    }
    return { extraDays: 0, extraTrafficGb: settings.referredSignupBonusTrafficGb };
  }

  async recordReferredSignupPerk(
    referredUser: User,
    subscriptionId: string,
    adjustment: { extraDays: number; extraTrafficGb: number },
  ): Promise<void> {
    if (adjustment.extraDays === 0 && adjustment.extraTrafficGb === 0) return;

    await this.createRewardRow({
      referrerUserId: referredUser.id,
      referredUserId: referredUser.id,
      rewardType: 'referred_signup_perk',
      level: 1,
      daysGranted: adjustment.extraDays,
      trafficGbGranted: adjustment.extraTrafficGb,
      status: 'granted',
      creditedSubscriptionId: subscriptionId,
    });
  }

  // ---- §2.2: бонус пригласившему за активацию другом trial ----

  async grantReferrerSignupReward(referredUser: User): Promise<void> {
    if (!referredUser.referredByUserId) return;
    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.referrerSignupRewardEnabled) return;

    const referrerUserId = referredUser.referredByUserId;
    const recentCount = await this.rewardRepo.countRewardsSince(
      referrerUserId,
      'referrer_signup',
      new Date(Date.now() - SEVEN_DAYS_MS),
    );
    const capped = recentCount >= settings.referrerSignupRewardMaxPer7d;

    const target: RewardTarget = {
      referrerUserId,
      referredUserId: referredUser.id,
      rewardType: 'referrer_signup',
      level: 1,
    };

    const reward =
      settings.referrerSignupRewardType === 'days'
        ? await this.applyDaysReward(target, settings.referrerSignupRewardDays, capped, settings.maxBankedDays)
        : await this.applyTrafficReward(
            target,
            {
              trafficGb: settings.referrerSignupRewardTrafficGb,
              maxStackedGb: settings.referrerSignupTrafficMaxStackedGb,
              fallbackDays: settings.referrerSignupRewardTrafficFallbackDays,
            },
            capped,
            settings.maxBankedDays,
          );

    await this.notifySingleReward(reward, referredUser.firstName ?? 'друг');
  }

  // ---- §2.3/§2.4/§2.5: бонусы за первую оплату (конверсия), пирамида, вехи ----

  /**
   * @param purchasedPlanDurationDays нужен только для conversionRewardMode='percent_of_purchase' —
   * план не уточняет точную формулу этого режима, интерпретируем как процент от длительности
   * купленного тарифа (а не от суммы в рублях/звёздах, которую бессмысленно конвертировать в дни).
   */
  async processConversionRewards(
    buyer: User,
    paymentId: string,
    purchasedPlanDurationDays: number,
  ): Promise<void> {
    if (!buyer.referredByUserId) return;
    const settings = await this.settingsService.get();
    if (!settings.enabled) return;

    const referrerUserId = buyer.referredByUserId;
    const recentConversions = await this.rewardRepo.countCompletedConversionsSince(
      referrerUserId,
      new Date(Date.now() - THIRTY_DAYS_MS),
    );
    const capped = recentConversions >= settings.maxRewardedConversionsPer30d;

    const days =
      settings.conversionRewardMode === 'percent_of_purchase'
        ? Math.max(1, Math.floor((purchasedPlanDurationDays * settings.conversionRewardPercent) / 100))
        : settings.conversionRewardFlatDays;

    const daysTarget: RewardTarget = {
      referrerUserId,
      referredUserId: buyer.id,
      rewardType: 'referrer_conversion_l1_days',
      level: 1,
      triggerPaymentId: paymentId,
    };
    const daysReward = await this.applyDaysReward(daysTarget, days, capped, settings.maxBankedDays);

    let trafficReward: ReferralReward | null = null;
    if (settings.conversionTrafficBonusEnabled) {
      const trafficTarget: RewardTarget = {
        referrerUserId,
        referredUserId: buyer.id,
        rewardType: 'referrer_conversion_l1_traffic',
        level: 1,
        triggerPaymentId: paymentId,
      };
      trafficReward = await this.applyTrafficReward(
        trafficTarget,
        {
          trafficGb: settings.conversionTrafficBonusGb,
          maxStackedGb: settings.conversionTrafficBonusMaxStackedGb,
          fallbackDays: settings.conversionTrafficBonusFallbackDays,
        },
        capped,
        settings.maxBankedDays,
      );
    }

    await this.notifyConversionReward(daysReward, trafficReward, buyer.firstName ?? 'друг');

    if (daysReward && daysReward.status !== 'capped' && daysReward.status !== 'failed') {
      await this.checkMilestone(referrerUserId, buyer.id, settings);
      await this.grantLevel2Reward(referrerUserId, buyer.id, paymentId, daysReward.daysGranted, settings);
    }
  }

  private async checkMilestone(referrerUserId: string, buyerUserId: string, settings: ReferralSettings): Promise<void> {
    const convertedCount = await this.rewardRepo.countConvertedReferrals(referrerUserId);
    const milestone = settings.milestones.find((m) => m.convertedCount === convertedCount);
    if (!milestone) return;

    const reward = await this.applyDaysReward(
      {
        referrerUserId,
        referredUserId: buyerUserId,
        rewardType: 'milestone',
        level: 1,
        milestoneThreshold: milestone.convertedCount,
      },
      milestone.bonusDays,
      false,
      settings.maxBankedDays,
    );
    if (!reward || reward.status === 'failed') return;

    const referrer = await this.userRepo.findById(referrerUserId);
    if (!referrer) return;

    if (reward.status === 'pending_claim') {
      await this.notificationService.send({
        userId: referrer.id,
        telegramId: referrer.telegramId,
        type: 'referral_pending_reward',
        text: Texts.REFERRAL_PENDING_REWARD.replace('{firstName}', 'друг').replace(
          '{days}',
          String(reward.daysGranted),
        ),
        entityType: 'referral_reward',
        entityId: reward.id,
      });
      return;
    }

    await this.notificationService.send({
      userId: referrer.id,
      telegramId: referrer.telegramId,
      type: 'referral_milestone_reward',
      text: Texts.REFERRAL_MILESTONE_REWARD.replace('{convertedCount}', String(milestone.convertedCount)).replace(
        '{bonusDays}',
        String(milestone.bonusDays),
      ),
      entityType: 'referral_reward',
      entityId: reward.id,
    });
  }

  private async grantLevel2Reward(
    intermediateReferrerId: string,
    buyerUserId: string,
    paymentId: string,
    level1Days: number,
    settings: ReferralSettings,
  ): Promise<void> {
    const intermediateReferrer = await this.userRepo.findById(intermediateReferrerId);
    const grandparentId = intermediateReferrer?.referredByUserId;
    if (!grandparentId) return;

    const level2Days = Math.max(1, Math.floor((level1Days * settings.level2RewardPercent) / 100));

    const reward = await this.applyDaysReward(
      {
        referrerUserId: grandparentId,
        referredUserId: buyerUserId,
        rewardType: 'referrer_conversion_l2',
        level: 2,
        triggerPaymentId: paymentId,
      },
      level2Days,
      false,
      settings.maxBankedDays,
    );
    if (!reward || reward.status === 'failed' || reward.status === 'capped') return;

    const grandparent = await this.userRepo.findById(grandparentId);
    if (!grandparent) return;

    const triggerFirstName = intermediateReferrer?.firstName ?? 'друг';
    const isPending = reward.status === 'pending_claim';

    await this.notificationService.send({
      userId: grandparent.id,
      telegramId: grandparent.telegramId,
      type: isPending ? 'referral_pending_reward' : 'referral_conversion_reward',
      text: isPending
        ? Texts.REFERRAL_PENDING_REWARD.replace('{firstName}', triggerFirstName).replace(
            '{days}',
            String(reward.daysGranted),
          )
        : Texts.REFERRAL_CONVERSION_REWARD.replace('{firstName}', triggerFirstName)
            .replace('{days}', String(reward.daysGranted))
            .replace('{trafficClause}', ''),
      entityType: 'referral_reward',
      entityId: reward.id,
    });
  }

  // ---- Общие механики начисления/банковки (используются всеми типами наград выше) ----

  private async applyDaysReward(
    target: RewardTarget,
    days: number,
    capped: boolean,
    maxBankedDays: number,
  ): Promise<ReferralReward | null> {
    if (days <= 0) return null;

    if (capped) {
      return this.createRewardRow({ ...target, daysGranted: days, trafficGbGranted: 0, status: 'capped' });
    }

    const activeSub = await this.subscriptionRepo.findActiveByUserId(target.referrerUserId);

    // Кэп на "банк" неполученных дней (§2.6) — не даёт превратить накопленные pending_claim
    // в неограниченный бесплатный сервис впрок. Затрагивает только банковку, не выданные награды.
    if (!activeSub) {
      const alreadyBanked = await this.rewardRepo.sumPendingDays(target.referrerUserId);
      if (alreadyBanked + days > maxBankedDays) {
        return this.createRewardRow({ ...target, daysGranted: days, trafficGbGranted: 0, status: 'capped' });
      }
    }

    const row = await this.createRewardRow({
      ...target,
      daysGranted: days,
      trafficGbGranted: 0,
      status: activeSub ? 'granted' : 'pending_claim',
      creditedSubscriptionId: activeSub?.id ?? null,
    });
    if (!row || !activeSub) return row;

    try {
      await this.renewSubscriptionUseCase.execute(activeSub.id, days);
      return row;
    } catch (err) {
      getLogger().error({ err, rewardId: row.id }, 'Referral reward: failed to extend subscription with days');
      await this.rewardRepo.update(row.id, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return { ...row, status: 'failed' };
    }
  }

  private async applyTrafficReward(
    target: RewardTarget,
    opts: { trafficGb: number; maxStackedGb: number; fallbackDays: number },
    capped: boolean,
    maxBankedDays: number,
  ): Promise<ReferralReward | null> {
    if (opts.trafficGb <= 0 && opts.fallbackDays <= 0) return null;

    if (capped) {
      return this.createRewardRow({
        ...target,
        daysGranted: 0,
        trafficGbGranted: opts.trafficGb,
        status: 'capped',
      });
    }

    const activeSub = await this.subscriptionRepo.findActiveByUserId(target.referrerUserId);

    if (!activeSub) {
      // Нет подписки, к которой можно применить трафик — банкуем в единственной банкуемой
      // валюте (днях, §2.7); заберётся при следующей активации любой подписки. Тот же
      // кэп на "банк" (§2.6), что и в applyDaysReward.
      const alreadyBanked = await this.rewardRepo.sumPendingDays(target.referrerUserId);
      if (alreadyBanked + opts.fallbackDays > maxBankedDays) {
        return this.createRewardRow({
          ...target,
          daysGranted: opts.fallbackDays,
          trafficGbGranted: 0,
          status: 'capped',
        });
      }
      return this.createRewardRow({
        ...target,
        daysGranted: opts.fallbackDays,
        trafficGbGranted: 0,
        status: 'pending_claim',
        metadata: { bankedAsFallbackDays: true },
      });
    }

    const plan = await this.planRepo.findById(activeSub.planId);
    const isUnlimitedPaidPlan = plan?.type !== 'trial';

    if (isUnlimitedPaidPlan) {
      // Платный план в этом боте уже безлимитный — прибавка ГБ/день ничего не даст,
      // конвертируем в эквивалент днями (§2.2/§2.3.2).
      const row = await this.createRewardRow({
        ...target,
        daysGranted: opts.fallbackDays,
        trafficGbGranted: 0,
        status: 'granted',
        creditedSubscriptionId: activeSub.id,
        metadata: { trafficConvertedToFallbackDays: opts.fallbackDays },
      });
      if (!row) return null;
      try {
        await this.renewSubscriptionUseCase.execute(activeSub.id, opts.fallbackDays);
        return row;
      } catch (err) {
        getLogger().error({ err, rewardId: row.id }, 'Referral reward: failed to apply traffic fallback days');
        await this.rewardRepo.update(row.id, {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        return { ...row, status: 'failed' };
      }
    }

    const alreadyStacked = await this.rewardRepo.sumGrantedTrafficGb(target.referrerUserId, target.rewardType);
    const grantableGb = Math.max(0, opts.maxStackedGb - alreadyStacked);
    const actualGb = Math.min(opts.trafficGb, grantableGb);

    const row = await this.createRewardRow({
      ...target,
      daysGranted: 0,
      trafficGbGranted: actualGb,
      status: 'granted',
      creditedSubscriptionId: activeSub.id,
      metadata: actualGb < opts.trafficGb ? { stackingCeilingReached: true } : null,
    });
    if (!row || actualGb <= 0 || !activeSub.remnawaveUserId) return row;

    try {
      const currentBytes = await this.remnawaveService.getUserTrafficLimitBytes(activeSub.remnawaveUserId);
      const newBytes = (currentBytes ?? 0) + actualGb * GB_IN_BYTES;
      await this.remnawaveService.updateTrafficLimit(activeSub.remnawaveUserId, newBytes);
      return row;
    } catch (err) {
      getLogger().error({ err, rewardId: row.id }, 'Referral reward: failed to apply traffic bonus');
      await this.rewardRepo.update(row.id, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return { ...row, status: 'failed' };
    }
  }

  /**
   * INSERT — единственная точка идемпотентности: строка бронирует уникальный слот
   * (DB-констрейнт в ReferralReward.ts) ДО применения самой мутации в applyDaysReward/
   * applyTrafficReward. Дубликат (повторный вызов хука на том же триггере) тихо
   * возвращает null — тогда вызывающий код ничего не применяет повторно.
   */
  private async createRewardRow(input: {
    referrerUserId: string;
    referredUserId: string;
    rewardType: ReferralRewardType;
    level: number;
    daysGranted: number;
    trafficGbGranted: number;
    status: ReferralReward['status'];
    triggerPaymentId?: string | null;
    milestoneThreshold?: number | null;
    creditedSubscriptionId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<ReferralReward | null> {
    try {
      return await this.rewardRepo.create({
        referrerUserId: input.referrerUserId,
        referredUserId: input.referredUserId,
        rewardType: input.rewardType,
        level: input.level,
        daysGranted: input.daysGranted,
        trafficGbGranted: input.trafficGbGranted,
        status: input.status,
        triggerPaymentId: input.triggerPaymentId ?? null,
        milestoneConvertedCountThreshold: input.milestoneThreshold ?? null,
        creditedSubscriptionId: input.creditedSubscriptionId ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  private async notifySingleReward(reward: ReferralReward | null, triggerFirstName: string): Promise<void> {
    if (!reward || reward.status === 'capped' || reward.status === 'failed') return;
    const referrer = await this.userRepo.findById(reward.referrerUserId);
    if (!referrer) return;

    if (reward.status === 'pending_claim') {
      await this.notificationService.send({
        userId: referrer.id,
        telegramId: referrer.telegramId,
        type: 'referral_pending_reward',
        text: Texts.REFERRAL_PENDING_REWARD.replace('{firstName}', triggerFirstName).replace(
          '{days}',
          String(reward.daysGranted),
        ),
        entityType: 'referral_reward',
        entityId: reward.id,
      });
      return;
    }

    const text =
      reward.trafficGbGranted > 0
        ? Texts.REFERRAL_SIGNUP_REWARD_TRAFFIC.replace('{firstName}', triggerFirstName).replace(
            '{trafficGb}',
            String(reward.trafficGbGranted),
          )
        : Texts.REFERRAL_SIGNUP_REWARD_DAYS.replace('{firstName}', triggerFirstName).replace(
            '{days}',
            String(reward.daysGranted),
          );

    await this.notificationService.send({
      userId: referrer.id,
      telegramId: referrer.telegramId,
      type: 'referral_signup_reward',
      text,
      entityType: 'referral_reward',
      entityId: reward.id,
    });
  }

  private async notifyConversionReward(
    daysReward: ReferralReward | null,
    trafficReward: ReferralReward | null,
    triggerFirstName: string,
  ): Promise<void> {
    const primary = daysReward ?? trafficReward;
    if (!primary || primary.status === 'failed' || primary.status === 'capped') return;

    const referrer = await this.userRepo.findById(primary.referrerUserId);
    if (!referrer) return;

    const grantedDays = daysReward?.status === 'granted' ? daysReward.daysGranted : 0;
    const grantedTrafficGb = trafficReward?.status === 'granted' ? trafficReward.trafficGbGranted : 0;
    const bankedDays =
      (daysReward?.status === 'pending_claim' ? daysReward.daysGranted : 0) +
      (trafficReward?.status === 'pending_claim' ? trafficReward.daysGranted : 0);

    if (bankedDays > 0 && grantedDays === 0 && grantedTrafficGb === 0) {
      await this.notificationService.send({
        userId: referrer.id,
        telegramId: referrer.telegramId,
        type: 'referral_pending_reward',
        text: Texts.REFERRAL_PENDING_REWARD.replace('{firstName}', triggerFirstName).replace(
          '{days}',
          String(bankedDays),
        ),
        entityType: 'referral_reward',
        entityId: primary.id,
      });
      return;
    }

    const trafficClause =
      grantedTrafficGb > 0
        ? Texts.REFERRAL_CONVERSION_TRAFFIC_CLAUSE.replace('{trafficGb}', String(grantedTrafficGb))
        : '';

    await this.notificationService.send({
      userId: referrer.id,
      telegramId: referrer.telegramId,
      type: 'referral_conversion_reward',
      text: Texts.REFERRAL_CONVERSION_REWARD.replace('{firstName}', triggerFirstName)
        .replace('{days}', String(grantedDays))
        .replace('{trafficClause}', trafficClause),
      entityType: 'referral_reward',
      entityId: primary.id,
    });
  }
}
