import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { PaymentStatus } from '../../shared/types/index.js';
import { formatUserLabel } from '../../shared/utils/userLabel.js';

export interface PaymentListEntry {
  id: string;
  userId: string;
  userLabel: string;
  planLabel: string;
  amount: number;
  currency: string | null;
  provider: string;
  status: string;
  createdAt: Date;
}

export interface ListPaymentsResult {
  items: PaymentListEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export class ListPaymentsUseCase {
  constructor(private paymentRepo: IPaymentRepository) {}

  async execute(params: { status?: PaymentStatus; page: number; pageSize: number }): Promise<ListPaymentsResult> {
    const { items, total } = await this.paymentRepo.findPaginated({
      status: params.status,
      skip: params.page * params.pageSize,
      limit: params.pageSize,
    });

    return {
      items: items.map((payment) => ({
        id: payment.id,
        userId: payment.userId,
        userLabel: formatUserLabel(payment.user, payment.userId),
        planLabel: payment.plan?.name ?? payment.planId,
        amount: payment.amount,
        currency: payment.currency,
        provider: payment.provider,
        status: payment.status,
        createdAt: payment.createdAt,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }
}
