import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { generateId } from '../../shared/utils/index.js';

export type ReferralRewardType =
  | 'referred_signup_perk' // бонус самому приглашённому за переход по ссылке (§2.1, дни ИЛИ трафик)
  | 'referrer_signup' // бонус пригласившему за активацию другом trial (§2.2)
  | 'referrer_conversion_l1_days' // дневной бонус пригласившему за оплату другом (§2.3.1)
  | 'referrer_conversion_l1_traffic' // постоянная прибавка ГБ/день пригласившему за оплату другом (§2.3.2)
  | 'referrer_conversion_l2' // бонус «бабушке/дедушке» пирамиды (§2.4, только дни)
  | 'milestone'; // бонус за суммарное количество оплативших рефералов (§2.5)

export type ReferralRewardStatus = 'granted' | 'pending_claim' | 'capped' | 'failed';

/**
 * Ledger реферальных начислений — по образцу NotificationLog: событие + dedup-ключ +
 * статус, а не отдельный «умный» механизм начисления. См. docs/referral-program-plan.md §4.2.
 */
@Entity('referral_rewards')
@Unique(['triggerPaymentId', 'rewardType'])
@Unique(['referredUserId', 'rewardType'])
@Unique(['referrerUserId', 'milestoneConvertedCountThreshold'])
export class ReferralReward {
  @PrimaryColumn('uuid')
  id: string = generateId();

  // Кто получает выгоду (для 'referred_signup_perk' это сам приглашённый пользователь).
  @Index()
  @Column('uuid')
  referrerUserId: string;

  // Чьё действие стало триггером начисления.
  @Index()
  @Column('uuid')
  referredUserId: string;

  @Column({ type: 'varchar', length: 40 })
  rewardType: ReferralRewardType;

  // 1 = прямой реферал, 2 = «бабушка/дедушка» (пирамида, §2.4).
  @Column({ type: 'integer' })
  level: number;

  // Для конверсионных наград — Payment, который стал триггером. В паре с rewardType
  // обеспечивает идемпотентность (см. Unique выше).
  @Column({ type: 'uuid', nullable: true })
  triggerPaymentId: string | null = null;

  @Column({ type: 'integer', default: 0 })
  daysGranted: number = 0;

  // Для *_traffic начислений; 0 у чисто дневных строк.
  @Column({ type: 'integer', default: 0 })
  trafficGbGranted: number = 0;

  // Какая подписка реально была продлена/создана этим начислением.
  @Column({ type: 'uuid', nullable: true })
  creditedSubscriptionId: string | null = null;

  // Только для rewardType='milestone'.
  @Column({ type: 'integer', nullable: true })
  milestoneConvertedCountThreshold: number | null = null;

  @Column({ type: 'varchar', length: 20 })
  status: ReferralRewardStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMessage: string | null = null;

  // Например { trafficConvertedToFallbackDays: 2 }, когда *_traffic-награда автоматически
  // конвертируется в эквивалент днями (реферер уже на безлимитном платном плане) — §2.2/§2.3.2.
  // Произвольный формат, читается только админ-панелью.
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null = null;
}
