import type { IUserRepository } from '../../domain/interfaces/repositories.js';

export interface UsersGrowthPoint {
  /** YYYY-MM-DD */
  date: string;
  newUsers: number;
  totalUsers: number;
}

export interface UsersGrowthResult {
  days: number;
  series: UsersGrowthPoint[];
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Кумулятивный график роста пользователей для дашборда веб-админки: `days`
 * точек по дням, каждая — суммарное число пользователей на конец дня.
 * Считается как база (все, кто зарегистрировался до начала диапазона) +
 * бегущая сумма новых регистраций по дням внутри диапазона, а не count()
 * на каждый день отдельно — один агрегирующий запрос вместо N.
 */
export class GetUsersGrowthUseCase {
  constructor(private userRepo: IUserRepository) {}

  async execute(days: number): Promise<UsersGrowthResult> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const since = new Date(today);
    since.setDate(since.getDate() - (days - 1));

    const [baseline, registrations] = await Promise.all([
      this.userRepo.countCreatedBefore(since),
      this.userRepo.getDailyRegistrations(since),
    ]);

    const newUsersByDate = new Map(registrations.map((row) => [row.date, row.count]));

    const series: UsersGrowthPoint[] = [];
    let runningTotal = baseline;
    for (let i = 0; i < days; i++) {
      const day = new Date(since);
      day.setDate(day.getDate() + i);
      const dateKey = toDateKey(day);
      const newUsers = newUsersByDate.get(dateKey) ?? 0;
      runningTotal += newUsers;
      series.push({ date: dateKey, newUsers, totalUsers: runningTotal });
    }

    return { days, series };
  }
}
