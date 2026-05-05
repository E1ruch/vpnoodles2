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
import type { PaymentStatus, PaymentProvider } from '../../shared/types/index.js';
import { User } from './User.js';
import { Plan } from './Plan.js';

@Entity('payments')
export class Payment {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  planId: string;

  @Column({ type: 'enum', enum: ['stars', 'yookassa', 'crypto'] })
  provider: PaymentProvider;

  @Column({ type: 'enum', enum: ['pending', 'completed', 'failed', 'refunded'] })
  status: PaymentStatus;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency: string | null = null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  externalPaymentId: string | null = null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null = null;

  @Column({ type: 'boolean', default: false })
  isIdempotent: boolean = false;

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
}
