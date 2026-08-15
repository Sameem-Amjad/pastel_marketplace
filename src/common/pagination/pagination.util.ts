import { CursorPaginationMeta, OffsetPaginationMeta } from '../interfaces/api-response.interface';
import { Page } from './cursor.util';

/**
 * Builders for the `meta` block of a paginated success envelope. Both shapes are supported because the
 * two pagination strategies answer different questions:
 *
 *   • cursor  — infinite-scroll feeds (listings, notifications, followers). Flat latency at any depth.
 *   • offset  — bounded admin tables where a user picks "page 7" and expects an exact total.
 */

export interface CursorMetaInput {
  /** The page size the caller asked for (echoed so the client can size its next request). */
  perPage: number;
  /** Whether this request carried a `?cursor=` — i.e. whether a previous page exists. */
  hasPrevious: boolean;
}

export function buildCursorMeta<T>(page: Page<T>, input: CursorMetaInput): CursorPaginationMeta {
  return {
    perPage: input.perPage,
    count: page.items.length,
    nextCursor: page.nextCursor,
    hasNext: page.nextCursor !== null,
    hasPrevious: input.hasPrevious,
    ...(page.approxTotal === undefined ? {} : { approxTotal: page.approxTotal }),
  };
}

export interface OffsetMetaInput {
  page: number;
  limit: number;
  total: number;
}

export function buildOffsetMeta({ page, limit, total }: OffsetMetaInput): OffsetPaginationMeta {
  const safeLimit = Math.max(1, limit);
  const totalPages = total === 0 ? 0 : Math.ceil(total / safeLimit);
  return {
    page,
    limit: safeLimit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1 && total > 0,
  };
}

/** Translates a page/limit query into the `skip`/`take` a Prisma `findMany` expects. */
export function toSkipTake(page: number, limit: number): { skip: number; take: number } {
  return { skip: (Math.max(1, page) - 1) * limit, take: limit };
}
