import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { generateId } from '../../shared/utils/index.js';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  action: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityType: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityId: string | null = null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null = null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
