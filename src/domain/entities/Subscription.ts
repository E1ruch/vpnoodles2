import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { generateId } from '../../shared/utils/index.js';
import type { SubscriptionStatus } from '../../shared/types/index.js';
import { User } from './User.js';
import { Plan } from './Plan.js';

@Entity('subscriptions')
export class Subscription {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  planId: string;

  @Column({ type: 'enum', enum: ['active', 'expired', 'suspended', 'pending'] })
  status: SubscriptionStatus;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({ type: 'integer', default: 1 })
  deviceLimit: number;

  @Column({ type: 'integer', default: 0 })
  usedDevices: number = 0;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remnawaveUserId: string | null = null;

  @Column({ type: 'text', nullable: true })
  subscriptionUrl: string | null = null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'planId' })
  plan: Plan;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  get isActive(): boolean {
    return this.status === 'active' && this.endDate > new Date();
  }

  get isExpired(): boolean {
    return this.status === 'expired' || this.endDate <= new Date();
  }
}
