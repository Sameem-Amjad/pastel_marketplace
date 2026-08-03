import { BadRequestException, Injectable } from '@nestjs/common';
import { ReadPrismaService } from '../../common/prisma/read-prisma.service';
import { Cursor, decodeCursor, encodeCursor, Page } from '../../common/pagination/cursor.util';
import { SearchListingsDto } from './dto/search.dto';

export interface SearchHit {
  id: string;
  title: string;
  authorId: string;
  authorName: string | null;
  primaryImage: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  categoryL1: string | null;
  inStock: boolean;
  createdAt: string;
}

interface RawRow {
  id: string;
  title: string;
  author_id: string;
  author_name: string | null;
  primary_image: string | null;
  price_amount: bigint | null;
  price_currency: string | null;
  category_l1: string | null;
  in_stock: boolean;
  created_at: Date;
  sortval: string | number;
}

/**
 * Read-only search over the `listing_search` projection (doc 05). Runs on the read REPLICA so it never
 * contends with the write primary. Everything is keyset-paginated (no OFFSET) for flat latency at any
 * depth, and every value is a bound parameter (never string-concatenated) to prevent SQL injection.
 *
 * This is the single seam doc 05 calls out: swapping Postgres for OpenSearch/Typesense in Phase B means
 * reimplementing only this class — controllers and callers are unchanged.
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: ReadPrismaService) {}

  async queryListings(q: SearchListingsDto): Promise<Page<SearchHit>> {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    // ── filters ────────────────────────────────────────────────────────────
    const hasKeywords = !!q.keywords?.trim();
    if (hasKeywords) {
      where.push(`fts @@ websearch_to_tsquery('english', ${p(q.keywords)})`);
    }
    if (q.categoryL1) where.push(`category_l1 = ${p(q.categoryL1)}`);
    if (q.categoryL2) where.push(`category_l2 = ${p(q.categoryL2)}`);
    if (q.categoryL3) where.push(`category_l3 = ${p(q.categoryL3)}`);
    if (q.listingType) where.push(`listing_type = ${p(q.listingType)}`);
    if (q.condition) where.push(`condition = ${p(q.condition)}`);

    if (q.priceMin !== undefined) where.push(`price_amount >= ${p(q.priceMin)}`);
    // Upper bound is INCLUSIVE → compare < max+1 (doc 05).
    if (q.priceMax !== undefined) where.push(`price_amount < ${p(q.priceMax + 1)}`);

    if (q.materialsAll?.length) where.push(`materials @> ${p(q.materialsAll)}::text[]`);
    if (q.materialsAny?.length) where.push(`materials && ${p(q.materialsAny)}::text[]`);

    // Tri-state stock: 'in' keeps only in_stock (infinite-stock already true in the projection).
    if (q.stock === 'in') where.push(`in_stock = true`);

    // ── sort + keyset cursor ─────────────────────────────────────────────────
    const sort = q.sort ?? '-createdAt';
    if (sort === 'relevance' && !hasKeywords) {
      throw new BadRequestException('sort=relevance requires keywords');
    }
    const { sortSql, sortValExpr, sortType, pgType, comparator } = this.sortPlan(sort, q.keywords, p);

    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) throw new BadRequestException('Invalid cursor');
    if (cursor) {
      // Keyset seek: (sortval, id) compared as a row tuple, matching ORDER BY exactly so the index is
      // used. The cursor value is bound as text and cast to the column's NATIVE type (pgType): price is
      // bigint, popularity/relevance double precision, created_at timestamptz. Casting the VALUE (not the
      // column) preserves the Index Cond — casting the column instead forced a seq filter (~5000× slower).
      where.push(
        `(${sortValExpr}, id) ${comparator} (${p(cursor.v)}::${pgType}, ${p(cursor.id)}::uuid)`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = q.perPage + 1; // fetch one extra to know if there's a next page

    const sql = `
      SELECT id, title, author_id, author_name, primary_image, price_amount, price_currency,
             category_l1, in_stock, created_at, ${sortValExpr} AS sortval
      FROM listing_search
      ${whereSql}
      ORDER BY ${sortSql}
      LIMIT ${p(limit)}`;

    const rows = await this.db.$queryRawUnsafe<RawRow[]>(sql, ...params);

    // Build the page from RAW rows (they carry `sortval` + id needed for the next cursor), then map.
    const hasMore = rows.length > q.perPage;
    const pageRows = hasMore ? rows.slice(0, q.perPage) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(this.cursorFor(last, sortType)) : null;
    return { items: pageRows.map((r) => this.toHit(r)), nextCursor };
  }

  /** Autocomplete via trigram word-similarity on the title index (doc 05). */
  async suggest(prefix: string, limit = 8): Promise<string[]> {
    const term = prefix.trim();
    if (term.length < 2) return [];
    const rows = await this.db.$queryRawUnsafe<{ title: string }[]>(
      `SELECT title FROM listing_search
       WHERE title %> $1
       ORDER BY word_similarity($1, title) DESC, created_at DESC
       LIMIT $2`,
      term,
      limit,
    );
    return rows.map((r) => r.title);
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private sortPlan(
    sort: string,
    keywords: string | undefined,
    p: (v: unknown) => string,
  ): {
    sortSql: string;
    sortValExpr: string;
    sortType: 'number' | 'timestamp';
    pgType: string; // native column type for the cursor-value cast (keeps the Index Cond)
    comparator: '<' | '>';
  } {
    switch (sort) {
      case 'createdAt':
        return { sortSql: 'created_at ASC, id ASC', sortValExpr: 'created_at', sortType: 'timestamp', pgType: 'timestamptz', comparator: '>' };
      case 'price':
        // raw bigint column — do NOT cast the column, or the listing_search_price index is bypassed.
        return { sortSql: 'price_amount ASC, id ASC', sortValExpr: 'price_amount', sortType: 'number', pgType: 'bigint', comparator: '>' };
      case '-price':
        return { sortSql: 'price_amount DESC, id DESC', sortValExpr: 'price_amount', sortType: 'number', pgType: 'bigint', comparator: '<' };
      case 'popularity':
        return { sortSql: 'popularity DESC, id DESC', sortValExpr: 'popularity', sortType: 'number', pgType: 'double precision', comparator: '<' };
      case 'relevance': {
        // ts_rank with the same query used in the filter; keyset on (rank, id). Ranked FTS cannot be
        // index-ordered, so this is bounded-depth by design (see AUDIT.md C2 / Phase-B engine).
        const rank = `ts_rank(fts, websearch_to_tsquery('english', ${p(keywords)}))::double precision`;
        return { sortSql: `${rank} DESC, id DESC`, sortValExpr: rank, sortType: 'number', pgType: 'double precision', comparator: '<' };
      }
      case '-createdAt':
      default:
        return { sortSql: 'created_at DESC, id DESC', sortValExpr: 'created_at', sortType: 'timestamp', pgType: 'timestamptz', comparator: '<' };
    }
  }

  private cursorFor(row: RawRow, sortType: 'number' | 'timestamp'): Cursor {
    const v = sortType === 'number' ? String(row.sortval) : (row.created_at as Date).toISOString();
    return { v, id: row.id };
  }

  private toHit(r: RawRow): SearchHit {
    return {
      id: r.id,
      title: r.title,
      authorId: r.author_id,
      authorName: r.author_name,
      primaryImage: r.primary_image,
      priceAmount: r.price_amount === null ? null : Number(r.price_amount),
      priceCurrency: r.price_currency,
      categoryL1: r.category_l1,
      inStock: r.in_stock,
      createdAt: (r.created_at as Date).toISOString(),
    };
  }
}
