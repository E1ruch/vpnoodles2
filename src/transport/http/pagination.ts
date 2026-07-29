export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Разбор `?page=&pageSize=` из query-параметров Express-роута с безопасными дефолтами/границами. */
export function parsePagination(query: Record<string, unknown>): { page: number; pageSize: number } {
  const pageRaw = Number.parseInt(String(query['page'] ?? '0'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 0;

  const pageSizeRaw = Number.parseInt(String(query['pageSize'] ?? DEFAULT_PAGE_SIZE), 10);
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  return { page, pageSize };
}
