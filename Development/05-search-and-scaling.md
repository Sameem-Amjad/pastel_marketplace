# 05 — Search & Scaling to Millions of Listings

> How the new backend serves fast, faceted search over **millions of listings**, and how the whole platform scales. Decision: **Postgres-first**, dedicated engine later. Schema in doc 02 §4.

---

## 1. What Sharetribe gave us (and we must rebuild)

The frontend (`SearchPage.duck.js`, `search.js`) queries Sharetribe's listing index directly with: extended-data filters (`pub_*`/`meta_*`), multi-enum `has_all`/`has_any`, numeric ranges, booleans, **price** range, **full-text keywords** + relevance, **geo** (origin + bounds), sort (`createdAt`/`price`/`relevance`), and page-based pagination (`perPage ≤ 100`). All indexed, all fast, all free. We reproduce it — and fix its limits (deep-offset cap, counters on the row).

---

## 2. Strategy: Postgres-first, engine-later

### Phase A — PostgreSQL (launch here)
One system, lower cost/ops. Postgres handles low-to-mid millions of rows with rich faceting if indexed well. Source of truth + search in one place.

### Phase B — Dedicated engine (OpenSearch or Typesense), when justified
Add when **metrics** demand it (not on a hunch): faceted-search p95 breaching SLO under real QPS, relevance/typo-tolerance gaps, or facet-count aggregations getting expensive. Postgres stays source of truth; the engine is a **derived index** fed by the outbox/CDC pipeline (§6). This is an additive, low-risk evolution because the search module's interface stays identical.

**Trigger metrics (write these into the dashboard):** search p95 > 300 ms sustained, facet-aggregation query > 150 ms, or full-text relevance complaints. Any one ⇒ start Phase B.

---

## 3. The search projection

Don't search the write-model directly. Maintain a **denormalized read projection** — a `listing_search` table (or materialized view + triggers) containing only what cards/filters need:

```sql
CREATE TABLE listing_search (
  id              uuid PRIMARY KEY,
  author_id       uuid NOT NULL,
  author_name     text,                 -- denormalized to avoid join on read
  primary_image   text,                 -- variant URL
  title           text NOT NULL,
  state           listing_state NOT NULL,
  price_amount    bigint,
  currency        char(3),
  category_l1     text, category_l2 text, category_l3 text,
  listing_type    text,
  condition       text, period text, origin text,
  materials       text[],               -- multi-enum
  in_stock        boolean,              -- stock_quantity > 0
  geo             geography(Point,4326),
  popularity      double precision,     -- views/rating blend, for relevance/sort
  created_at      timestamptz NOT NULL,
  fts             tsvector              -- to_tsvector(title || ' ' || description)
);
```
Only `state='published' AND deleted_at IS NULL` rows are present (sold/closed/draft excluded), so the index is lean. Updated via the outbox pipeline (§6) on listing/stock/review writes.

### Indexes (Phase A)
```sql
CREATE INDEX ON listing_search USING gin (fts);                              -- full-text
CREATE INDEX ON listing_search USING gin (title gin_trgm_ops);              -- fuzzy/substring
CREATE INDEX ON listing_search USING gin (materials);                        -- multi-enum has_all(@>)/has_any(&&)
CREATE INDEX ON listing_search USING gist (geo);                             -- geo radius/bounds
CREATE INDEX ON listing_search (category_l1, category_l2, category_l3);
CREATE INDEX ON listing_search (created_at DESC, id DESC);                   -- default sort + keyset
CREATE INDEX ON listing_search (price_amount, id);                          -- price sort/filter
CREATE INDEX ON listing_search (listing_type);
-- partial indexes per hot facet if cardinality is low, e.g. WHERE in_stock
```

### Query mapping
| Frontend param | SQL |
|---|---|
| `keywords=x` | `fts @@ websearch_to_tsquery('x')`, `ORDER BY ts_rank(...)` for relevance |
| `pub_categoryLevel1=a&...L2=b` | `category_l1='a' AND category_l2='b'` |
| `pub_materials=has_all:a,b` | `materials @> ARRAY['a','b']` |
| `pub_materials=has_any:a,b` | `materials && ARRAY['a','b']` |
| `price=min,max` | `price_amount BETWEEN min AND max` |
| `origin=lat,lng` (+radius) | `ST_DWithin(geo, ST_MakePoint(lng,lat)::geography, r)`, `ORDER BY geo <-> point` |
| `bounds=ne,sw` | `ST_Within(geo::geometry, ST_MakeEnvelope(...))` |
| `sort=-createdAt` | `ORDER BY created_at DESC, id DESC` |
| stock filter | `in_stock = true` |

Run all search reads on a **read replica**.

---

## 4. Pagination: cursor (keyset), not offset

Sharetribe (and naive `OFFSET`) degrade badly past tens of thousands of rows and cap result depth. We use **keyset pagination**:
```sql
-- next page after (last_sort, last_id)
WHERE (created_at, id) < ($lastCreatedAt, $lastId)
ORDER BY created_at DESC, id DESC
LIMIT $perPage;     -- default 24
```
The cursor is an opaque base64 of `(sortValue, id)`. Latency stays flat at any depth. Offset stays only for small admin/own-listing views. (Phase B uses `search_after` for the same effect.)

> Total counts: exact counts over millions are expensive. Return an **approximate total** (`reltuples` estimate or a capped count) and "more" cursors; the current UI uses `meta.totalPages`, so during the compat window we provide a bounded/approx total and migrate the UI to infinite-scroll/"load more" post-cutover.

---

## 5. Caching

| Layer | What | TTL |
|---|---|---|
| **CDN edge** | anonymous search result pages, listing detail (public), category trees, config assets, media | seconds–minutes; purge on write |
| **Redis** | hot listing cards, top-sellers, config, facet metadata, computed feeds | short, event-invalidated |
| **HTTP** | `Cache-Control` on public GETs; `no-cache` on authed/SSR | per-route |

Write-through/invalidate on the outbox event (`listing.published`/`updated`/`closed`). Authenticated requests bypass shared caches.

---

## 6. Keeping the projection in sync (outbox / CDC)

```
Listing/Stock/Review write (write-model, one tx)
   └─ INSERT Outbox('listing.changed', {id})
          │  relay worker
          ▼
   Upsert listing_search row  (Phase A)
   └─ (Phase B) also push doc to OpenSearch/Typesense
```
- **Phase A:** the relay upserts the `listing_search` row (or triggers maintain it synchronously for simple fields; outbox for denormalized fields like `author_name`, `popularity`).
- **Phase B:** the same relay additionally indexes to the engine. Backfill/rebuild is a batch job reading the write-model — the index is always rebuildable, never authoritative.
- Avoids dual-write inconsistency (no "wrote DB but not index" gaps).

---

## 7. Scaling the rest of the platform

### 7.1 Read/write separation
- **Writes** → primary. **Reads** (search, feeds, profiles, listing detail) → replicas via a separate Prisma datasource / read-router. Most marketplace traffic is reads.
- PgBouncer (transaction pooling) bounds connections across many app/worker replicas.

### 7.2 Hot-row avoidance
- **Counters off the row:** `ListingStats` (views/favorites/rating), incremented atomically or buffered in Redis and flushed — never the read-modify-write the current code does on `publicData.views`/`reviews` (which loses updates under load).
- **Reviews in their own table**, not an unbounded array on the listing.

### 7.3 Partitioning (when tables get big)
- `Order`, `OrderTransition`, `Notification`, `AnalyticsDaily`, `Outbox`, `AuditLog` are append-heavy → **range/time partition** (e.g. monthly) for fast pruning and cheap archival.
- `listing_search` can be partitioned by category or hash(id) if a single table's facet queries slow down (or that's the moment to go Phase B).

### 7.4 Async everything non-critical
Push, email, tax reporting, search indexing, image processing, IndexNow, analytics → all via BullMQ workers off the outbox. The request path stays short.

### 7.5 Stateless horizontal scale
API replicas autoscale on CPU/latency; workers autoscale on queue depth. No sticky sessions (token auth). Idempotency keys make retries safe.

### 7.6 Media at scale
Object storage + image-resize service (sharp worker or Imgix/Cloudflare Images) behind CDN. The `imageVariant.<name> → {w,h,fit}` contract becomes a signed/parameterized CDN URL scheme, so the frontend's variant code barely changes (doc 06). Originals in cold storage; variants cached at the edge.

---

## 8. Capacity model (order-of-magnitude)

| Metric | Assumption | Implication |
|---|---|---|
| Listings | 1M active, 10M historical | `listing_search` ≈ 1M lean rows; GIN/trgm indexes a few GB — fits in RAM on a mid managed PG. |
| Search QPS | 100–1000 reads/s peak | Replicas + CDN/Redis absorb most; Phase A Postgres handles faceted queries < 50 ms with the indexes above for typical filters. |
| Write throughput | 100s writes/s peak | Primary + outbox; partition append-heavy tables. |
| Order volume | thousands/day → millions/yr | Partition `Order`/`OrderTransition` monthly. |
| Images | millions | Object storage (effectively unbounded) + CDN. |

These are starting points; the dashboards (search p95, replica lag, queue depth, index size, cache hit-rate) drive when to add replicas, partition, or move to Phase B.

---

## 9. Search module interface (so Phase B is a swap)

```ts
interface SearchService {
  queryListings(q: ListingQuery): Promise<{ items: ListingCard[]; cursor?: string; approxTotal?: number }>;
  suggest(prefix: string): Promise<string[]>;
  indexListing(id: string): Promise<void>;   // called by outbox relay
  removeListing(id: string): Promise<void>;
}
```
Phase A implements this over Postgres; Phase B swaps the impl to OpenSearch/Typesense with **no controller or frontend change**. That clean seam is the whole point of starting on Postgres without painting ourselves into a corner.

---

## 10. Build order (search)
1. `listing_search` projection + indexes + outbox relay (Phase A).
2. Query builder (filters/FTS/sort/keyset) on read replica.
3. CDN/Redis caching + invalidation.
4. Load test at 1M+ synthetic listings; capture the trigger metrics.
5. Only if triggered: stand up Phase-B engine + dual-index + cutover read path.
