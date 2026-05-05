import 'reflect-metadata';
import 'dotenv/config';
import { getDataSource } from './connection.js';
import { getLogger } from '../../shared/logger/index.js';
import { Plan } from '../../domain/entities/Plan.js';

async function seed(): Promise<void> {
  const logger = getLogger();

  try {
    const ds = await getDataSource();
    const planRepo = ds.getRepository(Plan);

    // Seed trial plan
    const existingTrial = await planRepo.findOne({ where: { type: 'trial' } });
    if (!existingTrial) {
      await planRepo.save(
        planRepo.create({
          name: 'Бесплатный',
          type: 'trial',
          durationDays: 7,
          deviceLimit: 2,
          priceStars: 0,
          priceRub: 0,
          isActive: true,
          sortOrder: 0,
          remnawaveTag: 'TRIAL',
          description: '7 дней бесплатного VPN, 2 устройства',
        }),
      );
      logger.info('Trial plan seeded');
    }

    // Seed paid plans
    const paidPlans = [
      {
        name: '1 месяц',
        durationDays: 30,
        deviceLimit: 3,
        priceStars: 80,
        priceRub: 149,
        sortOrder: 1,
        remnawaveTag: '1_MONTH',
        description: '30 дней, 3 устройства',
      },
      {
        name: '3 месяца',
        durationDays: 90,
        deviceLimit: 5,
        priceStars: 225,
        priceRub: 399,
        sortOrder: 2,
        remnawaveTag: '3_MONTHS',
        description: '90 дней, 5 устройств — выгода 16%',
      },
      {
        name: '1 год',
        durationDays: 365,
        deviceLimit: 10,
        priceStars: 680,
        priceRub: 1199,
        sortOrder: 3,
        remnawaveTag: '1_YEAR',
        description: '365 дней, 10 устройств — выгода 37%',
      },
    ];

    for (const planData of paidPlans) {
      const existing = await planRepo.findOne({ where: { name: planData.name } });
      if (!existing) {
        await planRepo.save(
          planRepo.create({
            ...planData,
            type: 'paid',
            isActive: true,
          }),
        );
        logger.info({ plan: planData.name }, 'Paid plan seeded');
      }
    }

    logger.info('Seeding complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Seeding failed');
    process.exit(1);
  }
}

seed();
