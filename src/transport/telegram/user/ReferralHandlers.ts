import { Context, Telegraf } from 'telegraf';
import type { IUserRepository, IReferralRewardRepository } from '../../../domain/interfaces/repositories.js';
import type { ReferralSettingsService } from '../../../application/usecases/referral/ReferralSettingsService.js';
import { getLogger } from '../../../shared/logger/index.js';
import { Texts } from '../texts.js';
import { backToMainKeyboard, referralProgramKeyboard } from '../keyboards.js';

/**
 * Экран "Реферальная программа" (§6.2 плана) — ссылка, статистика, прогресс до
 * следующей вехи. Следует тому же паттерну доменного хендлера, что и
 * DeviceHandlers/PaymentHandlers/SubscriptionHandlers.
 */
export class ReferralHandlers {
  constructor(
    private userRepo: IUserRepository,
    private referralRewardRepo: IReferralRewardRepository,
    private referralSettings: ReferralSettingsService,
  ) {}

  register(bot: Telegraf): void {
    bot.action('referral_program', this.handleReferralProgram);
  }

  private handleReferralProgram = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const settings = await this.referralSettings.get();
      if (!settings.enabled) {
        await ctx.editMessageText(Texts.REFERRAL_PROGRAM_DISABLED, { reply_markup: backToMainKeyboard() });
        return;
      }

      const referralCode = await this.userRepo.getOrCreateReferralCode(user.id);
      const botUsername = ctx.botInfo?.username;
      // botInfo заполняется телеграфом при старте (getMe()) и практически всегда доступен;
      // без него ссылка всё равно должна на что-то указывать, а не падать с ошибкой.
      const referralLink = botUsername
        ? `https://t.me/${botUsername}?start=r_${referralCode}`
        : `https://t.me/?start=r_${referralCode}`;

      const [invitedCount, convertedCount, totalDaysGranted, totalTrafficGranted, pendingDays] = await Promise.all([
        this.userRepo.countReferredBy(user.id),
        this.referralRewardRepo.countConvertedReferrals(user.id),
        this.referralRewardRepo.sumGrantedDaysTotal(user.id),
        this.referralRewardRepo.sumGrantedTrafficGbTotal(user.id),
        this.referralRewardRepo.sumPendingDays(user.id),
      ]);

      const signupPerkLine =
        settings.referredSignupBonusType === 'days'
          ? `+${settings.referredSignupBonusDays} дней в подарок`
          : `+${settings.referredSignupBonusTrafficGb} ГБ/день трафика в подарок`;

      const referrerSignupLine =
        settings.referrerSignupRewardType === 'days'
          ? `+${settings.referrerSignupRewardDays} дней`
          : `+${settings.referrerSignupRewardTrafficGb} ГБ/день`;

      const conversionTrafficClause = settings.conversionTrafficBonusEnabled
        ? ` и +${settings.conversionTrafficBonusGb} ГБ/день трафика навсегда`
        : '';

      const sortedMilestones = [...settings.milestones].sort((a, b) => a.convertedCount - b.convertedCount);
      const milestonesBlock =
        sortedMilestones.length > 0
          ? `\n🏆 Чем больше друзей оплатят подписку, тем больше бонус:\n${sortedMilestones
              .map((m) =>
                Texts.REFERRAL_PROGRAM_MILESTONE_ROW.replace('{convertedCount}', String(m.convertedCount)).replace(
                  '{bonusDays}',
                  String(m.bonusDays),
                ),
              )
              .join('\n')}${this.buildMilestoneProgressLine(sortedMilestones, convertedCount)}\n`
          : '';

      const pendingClaimLine =
        pendingDays > 0
          ? Texts.REFERRAL_PROGRAM_PENDING_LINE.replace('{pendingDays}', String(pendingDays))
          : '';

      const text = Texts.REFERRAL_PROGRAM.replace('{signupPerkLine}', signupPerkLine)
        .replace('{referrerSignupLine}', referrerSignupLine)
        .replace('{conversionDays}', String(settings.conversionRewardFlatDays))
        .replace('{conversionTrafficClause}', conversionTrafficClause)
        .replace('{milestonesBlock}', milestonesBlock)
        .replace('{invitedCount}', String(invitedCount))
        .replace('{convertedCount}', String(convertedCount))
        .replace('{totalDaysGranted}', String(totalDaysGranted))
        .replace('{totalTrafficGranted}', String(totalTrafficGranted))
        .replace('{pendingClaimLine}', pendingClaimLine)
        .replace('{referralLink}', referralLink);

      await ctx.editMessageText(text, { reply_markup: referralProgramKeyboard(referralLink) });
    } catch (err) {
      logger.error({ err }, 'Error in referral_program handler');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private buildMilestoneProgressLine(
    sortedMilestones: Array<{ convertedCount: number; bonusDays: number }>,
    convertedCount: number,
  ): string {
    const next = sortedMilestones.find((m) => m.convertedCount > convertedCount);
    if (!next) return '';
    return (
      '\n' +
      Texts.REFERRAL_PROGRAM_MILESTONE_PROGRESS.replace('{remaining}', String(next.convertedCount - convertedCount))
    );
  }
}
