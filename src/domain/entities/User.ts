import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
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

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
