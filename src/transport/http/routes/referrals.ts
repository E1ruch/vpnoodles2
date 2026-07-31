import { Router } from 'express';
import type { GetReferralOverviewUseCase } from '../../../application/usecases/referral/GetReferralOverviewUseCase.js';
import type { GetTopReferrersUseCase } from '../../../application/usecases/referral/GetTopReferrersUseCase.js';
import type { ListReferralRewardsUseCase } from '../../../application/usecases/referral/ListReferralRewardsUseCase.js';
import type { ReferralSettingsService } from '../../../application/usecases/referral/ReferralSettingsService.js';
import type { ReferralSettings } from '../../../domain/entities/ReferralSettings.js';
import { getLogger } from '../../../shared/logger/index.js';
import { parsePagination } from '../pagination.js';

const DEFAULT_TOP_LIMIT = 10;
const MAX_TOP_LIMIT = 100;

const STRING_ENUM_FIELDS: Record<string, readonly string[]> = {
  referredSignupBonusType: ['days', 'traffic_gb'],
  referrerSignupRewardType: ['days', 'traffic_gb'],
  conversionRewardMode: ['flat_days', 'percent_of_purchase'],
};

const BOOLEAN_FIELDS = ['enabled', 'referrerSignupRewardEnabled', 'conversionTrafficBonusEnabled'] as const;

const INTEGER_FIELDS = [
  'referredSignupBonusDays',
  'referredSignupBonusTrafficGb',
  'referrerSignupRewardDays',
  'referrerSignupRewardTrafficGb',
  'referrerSignupTrafficMaxStackedGb',
  'referrerSignupRewardTrafficFallbackDays',
  'referrerSignupRewardMaxPer7d',
  'conversionRewardFlatDays',
  'conversionRewardPercent',
  'conversionTrafficBonusGb',
  'conversionTrafficBonusMaxStackedGb',
  'conversionTrafficBonusFallbackDays',
  'level2RewardPercent',
  'maxRewardedConversionsPer30d',
  'maxBankedDays',
] as const;

/** Ручная валидация вместо схемы — то же соотношение усилий, что и у customNotifications.ts,
 * только поле генерируется циклом по спискам выше (полей ~20, схема была бы не короче). */
function parseSettingsUpdate(body: unknown): Partial<ReferralSettings> | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }
  const input = body as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  for (const [field, allowed] of Object.entries(STRING_ENUM_FIELDS)) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !allowed.includes(value)) {
      return { error: `${field} must be one of: ${allowed.join(', ')}` };
    }
    update[field] = value;
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      return { error: `${field} must be a boolean` };
    }
    update[field] = value;
  }

  for (const field of INTEGER_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return { error: `${field} must be a non-negative integer` };
    }
    update[field] = value;
  }

  if (input['milestones'] !== undefined) {
    if (!Array.isArray(input['milestones'])) {
      return { error: 'milestones must be an array' };
    }
    for (const entry of input['milestones']) {
      const row = entry as Record<string, unknown> | null;
      if (
        !row ||
        typeof row !== 'object' ||
        typeof row['convertedCount'] !== 'number' ||
        !Number.isInteger(row['convertedCount']) ||
        typeof row['bonusDays'] !== 'number' ||
        !Number.isInteger(row['bonusDays'])
      ) {
        return { error: 'each milestone must be { convertedCount: integer, bonusDays: integer }' };
      }
    }
    update['milestones'] = input['milestones'];
  }

  return update as Partial<ReferralSettings>;
}

export function createReferralsRouter(deps: {
  getReferralOverview: GetReferralOverviewUseCase;
  getTopReferrers: GetTopReferrersUseCase;
  listReferralRewards: ListReferralRewardsUseCase;
  referralSettings: ReferralSettingsService;
}): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/stats', async (_req, res) => {
    try {
      res.json(await deps.getReferralOverview.execute());
    } catch (err) {
      logger.error({ err }, 'Failed to load referral stats');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/top', async (req, res) => {
    try {
      const limitRaw = Number.parseInt(String(req.query['limit'] ?? DEFAULT_TOP_LIMIT), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_TOP_LIMIT) : DEFAULT_TOP_LIMIT;
      res.json(await deps.getTopReferrers.execute(limit));
    } catch (err) {
      logger.error({ err }, 'Failed to load top referrers');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/settings', async (_req, res) => {
    try {
      res.json(await deps.referralSettings.get());
    } catch (err) {
      logger.error({ err }, 'Failed to load referral settings');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const parsed = parseSettingsUpdate(req.body);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      res.json(await deps.referralSettings.update(parsed));
    } catch (err) {
      logger.error({ err }, 'Failed to update referral settings');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      res.json(await deps.listReferralRewards.execute({ page, pageSize }));
    } catch (err) {
      logger.error({ err }, 'Failed to list referral rewards');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
