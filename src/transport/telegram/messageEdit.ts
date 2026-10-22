import type { Context } from 'telegraf';

/**
 * Безопасный editMessageText, общий для админских и пользовательских
 * хендлеров. Жил только в admin/adminShared.ts; вынесен на уровень выше, когда
 * выяснилось, что пользовательские разделы (устройства) ловят из-за его
 * отсутствия 400 "message is not modified" и показывают ERROR_GENERIC.
 */

export function isMessageNotModifiedError(err: unknown): boolean {
  const description =
    err && typeof err === 'object' && 'description' in err
      ? String((err as { description: unknown }).description)
      : err instanceof Error
        ? err.message
        : String(err);
  return description.includes('message is not modified');
}

export async function safeEditMessageText(
  ctx: Context,
  text: string,
  extra?: Parameters<Context['editMessageText']>[1],
): Promise<void> {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (isMessageNotModifiedError(err)) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => undefined);
      }
      return;
    }
    throw err;
  }
}
