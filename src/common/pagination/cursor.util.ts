/**
 * Keyset (cursor) pagination — doc 05.
 *
 * We NEVER use OFFSET on large tables: OFFSET N scans and discards N rows, so latency grows linearly
 * with depth. Keyset pagination seeks directly via an index on (sortValue, id), giving flat latency at
 * any page. The cursor is an opaque base64url token encoding the last row's (sortValue, id).
 */

export interface Cursor {
  /** The sort key value of the last row returned (e.g. ISO createdAt, or a numeric price as string). */
  v: string;
  /** Tie-breaker: the last row's id (uuid). Guarantees a total order even when sort values collide. */
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(token: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (typeof parsed?.v === 'string' && typeof parsed?.id === 'string') {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Approximate total — exact COUNT over millions of rows is too expensive (doc 05). */
  approxTotal?: number;
}

/**
 * Given `limit + 1` rows fetched from the DB, split off the extra row to compute the next cursor.
 * Callers fetch one more row than requested so we can tell whether another page exists without a count.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => Cursor,
  approxTotal?: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
    approxTotal,
  };
}
