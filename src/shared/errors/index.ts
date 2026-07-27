export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class PaymentError extends AppError {
  constructor(
    message: string,
    public readonly paymentId?: string,
  ) {
    super(message, 'PAYMENT_ERROR', 402);
  }
}

/**
 * Платёж в данный момент уже обрабатывается другим вызовом (webhook и polling-тик
 * пересеклись во времени, либо два polling-тика перекрылись). Это не сбой — это
 * штатное срабатывание distributed-лока в PurchasePlanUseCase. Вызывающий код должен
 * тихо пропустить платёж, а не логировать это как ошибку и не завершать его как failed.
 */
export class PaymentLockedError extends PaymentError {
  constructor(paymentId: string) {
    super('Payment fulfillment already in progress', paymentId);
  }
}

export class RemnawaveError extends AppError {
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message, 'REMNAWAVE_ERROR', 502);
  }
}

export class SubscriptionError extends AppError {
  constructor(message: string) {
    super(message, 'SUBSCRIPTION_ERROR', 409);
  }
}

export class DuplicateError extends AppError {
  constructor(resource: string, field: string) {
    super(`${resource} already exists: ${field}`, 'DUPLICATE', 409);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
