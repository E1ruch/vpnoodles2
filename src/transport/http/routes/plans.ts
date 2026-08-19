import { Router } from 'express';
import type { ListPlansUseCase } from '../../../application/usecases/ListPlansUseCase.js';
import type { CreatePlanUseCase } from '../../../application/usecases/CreatePlanUseCase.js';
import type { UpdatePlanUseCase, UpdatePlanInput } from '../../../application/usecases/UpdatePlanUseCase.js';
import type { DeletePlanUseCase } from '../../../application/usecases/DeletePlanUseCase.js';
import type { CreatePlanInput } from '../../../application/usecases/CreatePlanUseCase.js';
import { PlanInUseError } from '../../../shared/errors/index.js';
import { getLogger } from '../../../shared/logger/index.js';

const PLAN_TYPES = ['trial', 'paid'];

function parseRequiredString(value: unknown, field: string, maxLength: number): string | { error: string } {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    return { error: `${field} must be a non-empty string up to ${maxLength} characters` };
  }
  return value;
}

function parseNonNegativeInt(value: unknown, field: string): number | { error: string } {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { error: `${field} must be a non-negative integer` };
  }
  return value;
}

function parsePositiveInt(value: unknown, field: string): number | { error: string } {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { error: `${field} must be a positive integer` };
  }
  return value;
}

function parseNullableString(value: unknown, field: string, maxLength: number): string | null | { error: string } {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    return { error: `${field} must be a string up to ${maxLength} characters, or null` };
  }
  return value;
}

function hasError<T>(value: T | { error: string }): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/** Полная валидация для POST — все поля обязательны. */
function parseCreatePlanInput(body: unknown): CreatePlanInput | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }
  const input = body as Record<string, unknown>;

  const name = parseRequiredString(input['name'], 'name', 255);
  if (hasError(name)) return name;

  const type = input['type'];
  if (typeof type !== 'string' || !PLAN_TYPES.includes(type)) {
    return { error: `type must be one of: ${PLAN_TYPES.join(', ')}` };
  }

  const durationDays = parsePositiveInt(input['durationDays'], 'durationDays');
  if (hasError(durationDays)) return durationDays;

  const deviceLimit = parsePositiveInt(input['deviceLimit'], 'deviceLimit');
  if (hasError(deviceLimit)) return deviceLimit;

  const priceStars = parseNonNegativeInt(input['priceStars'], 'priceStars');
  if (hasError(priceStars)) return priceStars;

  const priceRub = parseNonNegativeInt(input['priceRub'], 'priceRub');
  if (hasError(priceRub)) return priceRub;

  if (typeof input['isActive'] !== 'boolean') {
    return { error: 'isActive must be a boolean' };
  }

  const sortOrder = parseNonNegativeInt(input['sortOrder'], 'sortOrder');
  if (hasError(sortOrder)) return sortOrder;

  const remnawaveTag = parseNullableString(input['remnawaveTag'], 'remnawaveTag', 100);
  if (hasError(remnawaveTag)) return remnawaveTag;

  const description = parseNullableString(input['description'], 'description', 2000);
  if (hasError(description)) return description;

  return {
    name: name.trim(),
    type: type as CreatePlanInput['type'],
    durationDays,
    deviceLimit,
    priceStars,
    priceRub,
    isActive: input['isActive'],
    sortOrder,
    remnawaveTag,
    description,
  };
}

/** Частичная валидация для PUT — присутствующие поля валидируются, отсутствующие не трогаются. */
function parseUpdatePlanInput(body: unknown): UpdatePlanInput | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }
  const input = body as Record<string, unknown>;
  const result: UpdatePlanInput = {};

  if ('name' in input) {
    const name = parseRequiredString(input['name'], 'name', 255);
    if (hasError(name)) return name;
    result.name = name.trim();
  }
  if ('type' in input) {
    const type = input['type'];
    if (typeof type !== 'string' || !PLAN_TYPES.includes(type)) {
      return { error: `type must be one of: ${PLAN_TYPES.join(', ')}` };
    }
    result.type = type as CreatePlanInput['type'];
  }
  if ('durationDays' in input) {
    const durationDays = parsePositiveInt(input['durationDays'], 'durationDays');
    if (hasError(durationDays)) return durationDays;
    result.durationDays = durationDays;
  }
  if ('deviceLimit' in input) {
    const deviceLimit = parsePositiveInt(input['deviceLimit'], 'deviceLimit');
    if (hasError(deviceLimit)) return deviceLimit;
    result.deviceLimit = deviceLimit;
  }
  if ('priceStars' in input) {
    const priceStars = parseNonNegativeInt(input['priceStars'], 'priceStars');
    if (hasError(priceStars)) return priceStars;
    result.priceStars = priceStars;
  }
  if ('priceRub' in input) {
    const priceRub = parseNonNegativeInt(input['priceRub'], 'priceRub');
    if (hasError(priceRub)) return priceRub;
    result.priceRub = priceRub;
  }
  if ('isActive' in input) {
    if (typeof input['isActive'] !== 'boolean') {
      return { error: 'isActive must be a boolean' };
    }
    result.isActive = input['isActive'];
  }
  if ('sortOrder' in input) {
    const sortOrder = parseNonNegativeInt(input['sortOrder'], 'sortOrder');
    if (hasError(sortOrder)) return sortOrder;
    result.sortOrder = sortOrder;
  }
  if ('remnawaveTag' in input) {
    const remnawaveTag = parseNullableString(input['remnawaveTag'], 'remnawaveTag', 100);
    if (hasError(remnawaveTag)) return remnawaveTag;
    result.remnawaveTag = remnawaveTag;
  }
  if ('description' in input) {
    const description = parseNullableString(input['description'], 'description', 2000);
    if (hasError(description)) return description;
    result.description = description;
  }

  return result;
}

export function createPlansRouter(deps: {
  listPlans: ListPlansUseCase;
  createPlan: CreatePlanUseCase;
  updatePlan: UpdatePlanUseCase;
  deletePlan: DeletePlanUseCase;
}): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (_req, res) => {
    try {
      res.json(await deps.listPlans.execute());
    } catch (err) {
      logger.error({ err }, 'Failed to list plans');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const parsed = parseCreatePlanInput(req.body);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const plan = await deps.createPlan.execute(parsed);
      res.status(201).json(plan);
    } catch (err) {
      logger.error({ err }, 'Failed to create plan');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const parsed = parseUpdatePlanInput(req.body);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const plan = await deps.updatePlan.execute(req.params['id']!, parsed);
      res.json(plan);
    } catch (err) {
      logger.error({ err }, 'Failed to update plan');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await deps.deletePlan.execute(req.params['id']!);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof PlanInUseError) {
        res.status(err.statusCode).json({ error: 'Plan is used by existing subscriptions or payments and cannot be deleted' });
        return;
      }
      logger.error({ err }, 'Failed to delete plan');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
