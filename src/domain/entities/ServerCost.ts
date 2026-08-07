import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { generateId } from '../../shared/utils/index.js';

/**
 * Ручной учёт аренды сервера — Remnawave не отдаёт данные о стоимости/оплате,
 * это чисто ручной ввод админом. Одна строка на ноду (nodeUuid — uuid ноды в
 * Remnawave). nodeName — снимок на момент последнего сохранения, чтобы у
 * записи было читаемое имя, даже если нода потом исчезнет из Remnawave.
 */
@Entity('server_costs')
export class ServerCost {
  @PrimaryColumn('uuid')
  id: string = generateId();

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  nodeUuid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nodeName: string | null = null;

  @Column({ type: 'integer' })
  monthlyCostRub: number;

  @Column({ type: 'timestamp', nullable: true })
  nextPaymentDate: Date | null = null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null = null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
