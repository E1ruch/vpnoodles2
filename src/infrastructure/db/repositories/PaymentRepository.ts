import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { Payment } from '../../../domain/entities/Payment.js';
import type { IPaymentRepository } from '../../../domain/interfaces/repositories.js';
import type { PaymentProvider } from '../../../shared/types/index.js';

export class PaymentRepository implements IPaymentRepository {
  private getRepo(): Promise<Repository<Payment>> {
    return getDataSource().then((ds) => ds.getRepository(Payment));
  }

  async findById(id: string): Promise<Payment | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { id }, relations: ['user', 'plan'] });
  }

  async findByExternalId(externalId: string): Promise<Payment | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { externalPaymentId: externalId } });
  }

  async findByUserId(userId: string): Promise<Payment[]> {
    const repo = await this.getRepo();
    return repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async findPendingByUserId(userId: string): Promise<Payment | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { userId, status: 'pending' } });
  }

  async findPendingByProvider(provider: PaymentProvider): Promise<Payment[]> {
    const repo = await this.getRepo();
    return repo.find({
      where: { provider, status: 'pending' },
      order: { createdAt: 'ASC' },
    });
  }

  async findAll(): Promise<Payment[]> {
    const repo = await this.getRepo();
    return repo.find({ relations: ['user', 'plan'], order: { createdAt: 'DESC' } });
  }

  async count(): Promise<number> {
    const repo = await this.getRepo();
    return repo.count();
  }

  async create(data: Partial<Payment>): Promise<Payment> {
    const repo = await this.getRepo();
    const payment = repo.create(data);
    return repo.save(payment);
  }

  async update(id: string, data: Partial<Payment>): Promise<Payment> {
    const repo = await this.getRepo();
    await repo.update(id, data);
    const payment = await repo.findOne({ where: { id } });
    if (!payment) throw new Error(`Payment not found: ${id}`);
    return payment;
  }

  async findCompletedByUserIdAndPlanId(userId: string, planId: string): Promise<Payment | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { userId, planId, status: 'completed' } });
  }
}
