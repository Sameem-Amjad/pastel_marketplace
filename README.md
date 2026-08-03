# Pastel Backend (NestJS + PostgreSQL + Prisma)

Greenfield backend replacing Sharetribe Flex + the Express server + Firebase business features.
Design docs live in [`Development/`](./Development/) (read `Development/README.md` first).

This repo is being built **module-wise** against those docs. Status below.

---

## Status

| Phase | Module | State |
|---|---|---|
| 0 | Foundation: scaffold, Prisma schema (67 tables), Postgres performance layer, shared platform (Money, Prisma+replica, keyset pagination, outbox, idempotency, error envelopes) | ✅ built + validated |
| 1 | Identity & Auth: JWT access + rotating refresh (reuse detection), dual cookie/native-token transport, scopes + permissions guards, rate limiting, `/me` | ✅ built + validated E2E |
| 2 | Catalog & Search: listing CRUD + lifecycle, stock compare-and-set, `listing_search` projection, keyset search (full-text / facets / multi-enum / geo-ready) | ✅ built + validated at 200k rows |
| 3 | Orders / Payments **core**: order state machine, server-authoritative pricing engine, Stripe Connect escrow (swappable gateway), checkout, timer worker | ✅ core built + validated (21 tests). Refunds/disputes, tax/shipping, cart-stock, **Stripe webhooks + intent-pattern** → see AUDIT.md |
| 4 | Social (follow/favorites/stories/highlights), Notifications (feed/prefs/push, dedup), Admin/Ops (operator guard, restrictions, reports, appeals, audit log) | ✅ built (parallel subagents) + validated E2E |
| 5 | Adversarial audit pass (performance, Postgres optimality, DRY) — see [AUDIT.md](./AUDIT.md) | ✅ run; top perf/security findings fixed + proven |

---

## Prerequisites

- Node.js 20 LTS, npm 10+
- PostgreSQL 16+ (validated on 18.3). PostGIS optional (geo search is dormant — see below).
- Redis 7 (only needed once BullMQ workers land in Phase 3+).

## Setup

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / DIRECT_URL

createdb pastel_dev

# 1. Schema → DB. For real migration history use `prisma migrate dev`.
#    For a quick local sync: `npx prisma db push`.
npx prisma migrate dev --name init     # (requires PostGIS; see note)

# 2. Performance layer — partial/GIN/trigram indexes + the listing_search projection & triggers.
#    Idempotent; self-skips geo bits when PostGIS is absent.
npm run db:perf

npm run build
npm run start:dev               # API on http://localhost:3500  (Swagger at /docs)
```

> **PostGIS note.** The Prisma schema declares the `postgis` extension for the dormant geo column.
> If your local Postgres lacks PostGIS, validate with `prisma db push` against a schema without the
> two geo lines (the geo column + the `postgis` extension entry), or `brew install postgis`. Production
> targets PG16+ with PostGIS. `prisma/sql/performance.sql` already guards all geo objects behind an
> availability check, so it runs unchanged either way.

## Tests

```bash
npm test                        # unit (Money value object, …)
```

---

## Architecture & key decisions

- **Modular monolith.** One Nest app; each domain module owns its tables and exposes a service. No
  module reads another module's tables directly (doc 01 §4).
- **Postgres is the source of truth.** Search/caches are derived and rebuildable.
- **Money is integer minor units, always.** `src/common/money/money.ts` — bigint cents, decimal.js,
  HALF_UP rounding, currency carried on every value. Never floats. Never trusted from the client.
- **Reads scale via read/write separation + keyset pagination.** `ReadPrismaService` targets the
  replica; `src/common/pagination/cursor.util.ts` does keyset (never OFFSET) for flat latency at depth.
- **Transactional outbox** (`src/common/outbox`) writes events in the same DB transaction as the state
  change; a relay worker (Phase 3+) fans them out. At-least-once → consumers must be idempotent.
- **Auth dual transport.** `X-Native-Token` header (Capacitor) is checked **before** the `pa_at`
  cookie, so a stale anonymous cookie can never shadow a valid native token (doc 06).

### Audit decisions made during the build (doc 05 / "optimal Postgres")

1. **Heavy search indexes live ONLY on the derived `listing_search` projection, not the hot `Listing`
   write table** (doc 02 §12 lists them on `Listing`). Carrying full-text/trigram/materials-GIN/geo-GiST
   on the write model taxes every insert; the projection is updated once per change by trigger and is the
   only thing the read path touches. Cheaper writes, faster reads. (`prisma/sql/performance.sql` header.)
2. **UUID PKs use `@default(uuid(7))`** (app-generated, time-ordered) instead of a DB `uuidv7()` function:
   identical index locality, portable across PG 16/17/18, no function dependency at migrate time.
3. **`refresh_listing_search` is NULL-defensive** (`COALESCE(materials,'{}')`) because migration ETL from
   Firestore can yield rows without a materials array — caught by a live insert test.
4. **Partial indexes** on every sweep/worker hot path (pending outbox, due timers, expiring reservations,
   unread notifications) keep those indexes tiny and hot.

### Validated (real Postgres, this build)

- 67 tables materialize from the schema; `performance.sql` applies clean.
- Search pipeline: published-only projection, infinite-stock → `in_stock=true`, close evicts via trigger.
- Auth E2E: signup/login/`/me`/refresh-rotation + **refresh-reuse → session revoked (401)**.
- **200k listings:** first page 0.37 ms, deep page via keyset 0.42 ms vs `OFFSET 100000` 156.9 ms (~400×).

## Project layout

```
prisma/
  schema.prisma            # 67 models, all enums, btree indexes
  sql/performance.sql      # GIN/trigram/partial indexes + listing_search projection + triggers
src/
  common/                  # Money, Prisma(+replica), pagination, outbox, idempotency, errors
  config/                  # typed env configuration
  health/                  # /healthz /readyz
  modules/
    identity/              # auth, tokens, guards, /me
    catalog/               # listings CRUD + lifecycle + stock CAS + search
```
