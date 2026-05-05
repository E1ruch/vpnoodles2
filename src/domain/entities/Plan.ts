import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { generateId } from '../../shared/utils/index.js';
import type { PlanType } from '../../shared/types/index.js';

@Entity('plans')
export class Plan {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'enum', enum: ['trial', 'paid'] })
  type: PlanType;

  @Column({ type: 'integer' })
  durationDays: number;

  @Column({ type: 'integer' })
  deviceLimit: number;

  @Column({ type: 'integer' })
  priceStars: number;

  @Column({ type: 'integer', default: 0 })
  priceRub: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number = 0;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
