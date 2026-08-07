import type { IServerCostRepository, IPaymentRepository } from '../../domain/interfaces/repositories.js';

export interface ServerCostMonthlyPoint {
  /** YYYY-MM */
  month: string;
  revenueRub: number;
  costRub: number;
}

export interface ServerCostSummary {
  totalMonthlyCostRub: number;
  currentMonthRevenueRub: number;
  /** null когда totalMonthlyCostRub === 0 — делить не на что. */
  coveragePercent: number | null;
  monthlyHistory: ServerCostMonthlyPoint[];
}

/**
 * Формат YYYY-MM по локальным компонентам даты, а не toISOString() — since/
 * monthDate ниже строятся через setDate/setHours/setMonth в локальном
 * времени, и toISOString() (UTC) может откатить полночь на день/месяц назад
 * в часовых поясах восточнее UTC, рассинхронизируя ключ с самой датой.
 */
function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Сравнение расходов на сервера с доходом для веб-админки. costRub в каждой
 * точке monthlyHistory — это текущий totalMonthlyCostRub (плоская база), а не
 * исторические расходы за тот месяц: ServerCost хранит только текущее
 * состояние, истории изменений нет. График показывает динамику дохода
 * относительно сегодняшней стоимости аренды, а не изменения самой стоимости.
 */
export class GetServerCostSummaryUseCase {
  constructor(
    private serverCostRepo: IServerCostRepository,
    private paymentRepo: IPaymentRepository,
  ) {}

  async execute(months = 12): Promise<ServerCostSummary> {
    const [costs, revenueRows] = await Promise.all([
      this.serverCostRepo.findAll(),
      this.paymentRepo.getMonthlyRevenueRub(months),
    ]);

    const totalMonthlyCostRub = costs.reduce((sum, c) => sum + c.monthlyCostRub, 0);
    const revenueByMonth = new Map(revenueRows.map((row) => [row.month, row.totalRub]));

    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    since.setMonth(since.getMonth() - (months - 1));

    const monthlyHistory: ServerCostMonthlyPoint[] = [];
    for (let i = 0; i < months; i++) {
      const monthDate = new Date(since);
      monthDate.setMonth(since.getMonth() + i);
      const monthKey = toMonthKey(monthDate);
      monthlyHistory.push({
        month: monthKey,
        revenueRub: revenueByMonth.get(monthKey) ?? 0,
        costRub: totalMonthlyCostRub,
      });
    }

    const currentMonthRevenueRub = monthlyHistory[monthlyHistory.length - 1]?.revenueRub ?? 0;
    const coveragePercent =
      totalMonthlyCostRub > 0 ? Math.round((currentMonthRevenueRub / totalMonthlyCostRub) * 100) : null;

    return { totalMonthlyCostRub, currentMonthRevenueRub, coveragePercent, monthlyHistory };
  }
}
