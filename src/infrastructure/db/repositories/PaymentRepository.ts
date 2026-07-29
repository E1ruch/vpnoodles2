import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { Payment } from '../../../domain/entities/Payment.js';
import type {
  IPaymentRepository,
  Paginated,
  RevenueBreakdownEntry,
  RevenueSummary,
} from '../../../domain/interfaces/repositories.js';
import type { PaymentProvider, PaymentStatus } from '../../../shared/types/index.js';

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
    return repo.find({ where: { userId }, relations: ['plan'], order: { createdAt: 'DESC' } });
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

  async getRevenueSummary(): Promise<RevenueSummary> {
    const repo = await this.getRepo();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const queryFor = (since?: Date) => {
      const qb = repo
        .createQueryBuilder('payment')
        .select('payment.provider', 'provider')
        .addSelect('payment.currency', 'currency')
        .addSelect('SUM(payment.amount)', 'total')
        .addSelect('COUNT(*)', 'count')
        .where('payment.status = :status', { status: 'completed' })
        .groupBy('payment.provider')
        .addGroupBy('payment.currency');

      if (since) {
        qb.andWhere('payment.completedAt >= :since', { since });
      }

      return qb.getRawMany<{ provider: PaymentProvider; currency: string | null; total: string; count: string }>();
    };

    const mapRows = (
      rows: Array<{ provider: PaymentProvider; currency: string | null; total: string; count: string }>,
    ): RevenueBreakdownEntry[] =>
      rows.map((row) => ({
        provider: row.provider,
        currency: row.currency,
        total: Number(row.total),
        count: Number(row.count),
      }));

    const [today, last7Days, last30Days, allTime] = await Promise.all([
      queryFor(startOfToday),
      queryFor(sevenDaysAgo),
      queryFor(thirtyDaysAgo),
      queryFor(),
    ]);

    return {
      today: mapRows(today),
      last7Days: mapRows(last7Days),
      last30Days: mapRows(last30Days),
      allTime: mapRows(allTime),
    };
  }

  async findPaginated(params: { skip: number; limit: number; status?: PaymentStatus }): Promise<Paginated<Payment>> {
    const repo = await this.getRepo();
    const [items, total] = await repo.findAndCount({
      where: params.status ? { status: params.status } : {},
      relations: ['user', 'plan'],
      order: { createdAt: 'DESC' },
      skip: params.skip,
      take: params.limit,
    });
    return { items, total };
  }
}
