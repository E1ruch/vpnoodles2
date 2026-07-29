import type { User } from '../../domain/entities/User.js';

/** Единый формат отображения пользователя для веб-админки: @username или имя, иначе id. */
export function formatUserLabel(user: User | null | undefined, fallbackId: string): string {
  if (!user) return fallbackId;
  return user.username ? `@${user.username}` : (user.firstName ?? fallbackId);
}
