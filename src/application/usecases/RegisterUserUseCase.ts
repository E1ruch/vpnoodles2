import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import { getLogger } from '../../shared/logger/index.js';

export class RegisterUserUseCase {
  constructor(
    private userRepo: IUserRepository,
    private auditLogRepo: IAuditLogRepository,
  ) {}

  async execute(
    telegramId: number,
    username: string | null,
    firstName: string | null,
  ): Promise<string> {
    const logger = getLogger();

    const existing = await this.userRepo.findByTelegramId(telegramId);
    if (existing) {
      logger.info({ telegramId }, 'User already exists');
      return existing.id;
    }

    const user = await this.userRepo.create({
      telegramId,
      username: username ?? null,
      firstName: firstName ?? null,
      isActive: true,
      hasUsedTrial: false,
    });

    await this.auditLogRepo.create({
      userId: user.id,
      action: 'user_registered',
      entityType: 'user',
      entityId: user.id,
    });

    logger.info({ telegramId, userId: user.id }, 'User registered');
    return user.id;
  }
}
