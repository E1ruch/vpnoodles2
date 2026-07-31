import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { generateId } from '../../shared/utils/index.js';

@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Column({ type: 'bigint', unique: true })
  telegramId: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  firstName: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastName: string | null = null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  languageCode: string | null = null;

  @Column({ type: 'boolean', default: false })
  hasUsedTrial: boolean = false;

  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;

  // Реферальная программа (docs/referral-program-plan.md). Короткий шарибельный код,
  // генерируется лениво при первом обращении к разделу «Рефералы» (getOrCreateReferralCode),
  // а не бэкфиллится миграцией — см. §5.2/§8.2 плана.
  @Column({ type: 'varchar', length: 12, unique: true, nullable: true })
  referralCode: string | null = null;

  // Кто пригласил этого пользователя. Устанавливается один раз, только при самой первой
  // регистрации (RegisterUserUseCase), и никогда не меняется впоследствии — гарантия
  // неизменности атрибуции из §2.6 плана.
  @Index()
  @Column('uuid', { nullable: true })
  referredByUserId: string | null = null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
