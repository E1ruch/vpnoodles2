import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';
import { generateId } from '../../shared/utils/index.js';

export interface ReferralMilestone {
  convertedCount: number;
  bonusDays: number;
}

/**
 * Единственная строка настроек реферальной программы — редактируется из админ-панели,
 * без редеплоя. См. docs/referral-program-plan.md §7.4 для полной семантики каждого поля,
 * особенно `enabled` (глобальный «рубильник», см. комментарий там же).
 */
@Entity('referral_settings')
export class ReferralSettings {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Column({ type: 'boolean', default: true })
  enabled: boolean = true;

  // §2.1 — бонус самому приглашённому за активацию trial по ссылке.
  @Column({ type: 'varchar', length: 20, default: 'traffic_gb' })
  referredSignupBonusType: 'days' | 'traffic_gb' = 'traffic_gb';

  @Column({ type: 'integer', default: 5 })
  referredSignupBonusDays: number = 5;

  @Column({ type: 'integer', default: 3 })
  referredSignupBonusTrafficGb: number = 3;

  // §2.2 — бонус пригласившему за активацию другом trial.
  @Column({ type: 'boolean', default: true })
  referrerSignupRewardEnabled: boolean = true;

  @Column({ type: 'varchar', length: 20, default: 'traffic_gb' })
  referrerSignupRewardType: 'days' | 'traffic_gb' = 'traffic_gb';

  @Column({ type: 'integer', default: 2 })
  referrerSignupRewardDays: number = 2;

  @Column({ type: 'integer', default: 2 })
  referrerSignupRewardTrafficGb: number = 2;

  @Column({ type: 'integer', default: 8 })
  referrerSignupTrafficMaxStackedGb: number = 8;

  @Column({ type: 'integer', default: 1 })
  referrerSignupRewardTrafficFallbackDays: number = 1;

  @Column({ type: 'integer', default: 5 })
  referrerSignupRewardMaxPer7d: number = 5;

  // §2.3.1 — дневной бонус пригласившему за оплату другом.
  @Column({ type: 'varchar', length: 20, default: 'flat_days' })
  conversionRewardMode: 'flat_days' | 'percent_of_purchase' = 'flat_days';

  @Column({ type: 'integer', default: 10 })
  conversionRewardFlatDays: number = 10;

  @Column({ type: 'integer', default: 20 })
  conversionRewardPercent: number = 20;

  // §2.3.2 — постоянная прибавка ГБ/день пригласившему за оплату другом.
  @Column({ type: 'boolean', default: true })
  conversionTrafficBonusEnabled: boolean = true;

  @Column({ type: 'integer', default: 1 })
  conversionTrafficBonusGb: number = 1;

  @Column({ type: 'integer', default: 10 })
  conversionTrafficBonusMaxStackedGb: number = 10;

  @Column({ type: 'integer', default: 2 })
  conversionTrafficBonusFallbackDays: number = 2;

  // §2.4 — уровень 2 пирамиды, процент от дневного компонента уровня 1.
  @Column({ type: 'integer', default: 30 })
  level2RewardPercent: number = 30;

  // §2.5 — вехи по количеству оплативших рефералов.
  @Column({
    type: 'jsonb',
    default: () =>
      `'[{"convertedCount":5,"bonusDays":15},{"convertedCount":10,"bonusDays":40},{"convertedCount":25,"bonusDays":120}]'`,
  })
  milestones: ReferralMilestone[] = [
    { convertedCount: 5, bonusDays: 15 },
    { convertedCount: 10, bonusDays: 40 },
    { convertedCount: 25, bonusDays: 120 },
  ];

  // §2.6 — общие ограничители.
  @Column({ type: 'integer', default: 20 })
  maxRewardedConversionsPer30d: number = 20;

  @Column({ type: 'integer', default: 60 })
  maxBankedDays: number = 60;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
