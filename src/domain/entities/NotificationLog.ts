import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { generateId } from '../../shared/utils/index.js';

export type NotificationType =
  | 'no_subscription_reminder_1h'
  | 'no_subscription_reminder_3d'
  | 'trial_expiring_2d'
  | 'paid_expiring_2d';

/**
 * Журнал отправленных уведомлений.
 *
 * Существует отдельно от audit_logs и не затрагивает остальные таблицы БД.
 * Используется планировщиком уведомлений для дедупликации:
 * одна и та же связка (userId, type, entityId, cycleKey) отправляется один раз.
 */
@Entity('notification_logs')
export class NotificationLog {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 100 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entityType: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityId: string | null = null;

  /**
   * Ключ «цикла» для дедупликации повторяющихся уведомлений.
   * Например, для trial-окончания — это дата окончания подписки (YYYY-MM-DD),
   * чтобы после продления (новая endDate) уведомление ушло снова.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  cycleKey: string | null = null;

  @Column({ type: 'boolean', default: true })
  delivered: boolean = true;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMessage: string | null = null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  // Индекс для сортировки "последние" в админ-панели (было отдельным CREATE INDEX
  // в migrations/001_notification_logs.sql — перенесено сюда, чтобы migrate:safe
  // (TypeORM synchronize) воссоздавал его на любой новой БД без ручного SQL).
  @Index()
  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
