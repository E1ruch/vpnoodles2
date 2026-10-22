import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export function isExpired(date: Date): boolean {
  return date < new Date();
}

export function formatCurrency(amount: number, currency: string = 'RUB'): string {
  if (currency === 'XTR') {
    return `${amount} ⭐`;
  }
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Экранирует спецсимволы legacy Markdown (`parse_mode: 'Markdown'`) в данных,
 * которые мы не контролируем (названия устройств/платформ из Remnawave HWID,
 * имена пользователей и т.п.).
 *
 * Без этого один непарный `_`, `*`, `` ` `` или `[` в подставляемом значении
 * ломает ВСЁ сообщение: Telegram отвечает 400 "can't parse entities", хендлер
 * улетает в catch и пользователь видит «что-то пошло не так» вместо экрана.
 * Экранируются ровно четыре символа — именно их перечисляет Bot API для
 * legacy Markdown (в MarkdownV2 список шире, но мы его не используем).
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}

/**
 * Значение для вставки в inline-code (`` `...` ``) в legacy Markdown: внутри
 * code-entity экранирование не работает, поэтому ломающие символы вырезаем.
 */
export function sanitizeMarkdownCode(text: string): string {
  return text.replace(/[`\\]/g, '');
}

/**
 * formatDate() для внешних дат-строк: Intl бросает RangeError на Invalid Date,
 * а такие значения вполне прилетают из чужого API. Возвращает null вместо throw.
 */
export function formatDateSafe(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
