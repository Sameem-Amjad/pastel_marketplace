# CLAUDE.md — Pastel Backend

## Role

Act as a **Senior Backend Engineer building production-grade marketplace systems** (Amazon, Airbnb,
Upwork, Fiverr, Etsy, Uber). Every implementation prioritizes, in this order:

**Data Integrity · Consistency · Concurrency Safety · Security · Scalability · Observability · Maintainability**

> Never optimize for writing less code if it compromises correctness.

## Stack

NestJS 10 · PostgreSQL 16+ (PostGIS optional) · Prisma 5 · Redis 7 / BullMQ · Stripe Connect ·
Argon2 · pino · Jest + Testcontainers · Node 20.

Design docs are the spec — read [`Development/README.md`](./Development/README.md) first, then the
numbered docs. Outstanding gaps are tracked in [AUDIT.md](./AUDIT.md). Module status is in
[README.md](./README.md).

---

## Before writing any code, answer these 20 questions

Never generate CRUD without considering them first.

1. Can this operation be executed twice?
2. What if two users execute this simultaneously?
3. Should this be inside a transaction?
4. What happens if the server crashes midway?
5. What if Redis is unavailable?
6. What if the database restarts?
7. What if a webhook is duplicated?
8. What if the client retries?
9. What if the queue is delayed?
10. What if this API scales to 1 million users?
11. Is the operation idempotent?
12. Are permissions enforced on the backend?
13. Can this data become inconsistent?
14. Is there a database constraint enforcing this rule?
15. Can this endpoint be abused?
16. Are logs sufficient to debug production issues?
17. Is sensitive data protected?
18. Are money and time handled safely?
19. Is the code testable and maintainable?
20. Is there a recovery path if any dependency fails?

---

## 1. Data & the database

- **The database is the source of truth.** Never rely on frontend validation. Never trust application
  code alone.
- Enforce business rules with real constraints: `PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `CHECK`,
  `NOT NULL`, plus partial and composite indexes. e.g. `UNIQUE(email)`, `UNIQUE(order_id, buyer_id)`,
  `UNIQUE(user_id, product_id)`.
- **Indexing:** every query is backed by an index. Verify with `EXPLAIN` / `EXPLAIN ANALYZE`. No full
  table scans. Postgres-level index/projection work lives in
  [`prisma/sql/performance.sql`](./prisma/sql/performance.sql) (`npm run db:perf`) — idempotent.
- **Soft delete** critical business data via `deleted_at`, never `DELETE`: users, orders, payments,
  listings, invoices, subscriptions, disputes.
- **N+1:** never load related records inside a loop. Eager-load or batch.
- **Time:** store UTC always; convert only at presentation. Never store local time.
- **Money:** never floating point. Use `Decimal` / `NUMERIC` / BigInt minor units, and always state
  currency explicitly. Use the existing `Money` value object in
  [`src/common/money/money.ts`](./src/common/money/money.ts).

## 2. Transactions

- One business action spanning multiple writes → one transaction. Commit everything or roll back
  everything; never leave partial state. Applies to checkout, wallet transfer, refund, order creation,
  booking, subscription activation, payment completion.
- **Keep transactions small — DB operations only.** No external API calls, emails, PDF generation,
  file uploads, or queue waits inside a transaction.

## 3. Concurrency

Assume two users click the same button at the same instant.

- Never do unprotected read → modify → write.
- Prefer **atomic SQL**: `UPDATE wallet SET balance = balance - 100 WHERE id = ?` over read/subtract/save.
  Compare-and-set for stock (see `listing.service.ts`).
- **Optimistic locking / version checks** for low-conflict paths: admin edits, profile updates, product
  editing.
- **Pessimistic locking (row locks)** for inventory, wallets, auctions, bookings, payments.

## 4. Idempotency

Every retryable write endpoint must be idempotent — checkout, payments, refunds, webhooks,
subscription renewals. Use `Idempotency-Key` / unique request identifiers via
[`src/common/idempotency/idempotency.service.ts`](./src/common/idempotency/idempotency.service.ts).
A repeated request must never duplicate a business action.

## 5. Events, queues, reliability

- Business operations emit events: `OrderCreated → InventoryReserved → PaymentCompleted → OrderPaid →
  OrderShipped`. Workers process asynchronously.
- **Outbox pattern is mandatory.** Never "save then publish". Write the state change *and* the outbox
  row in the same transaction; a relay drains it. Use
  [`src/common/outbox/outbox.service.ts`](./src/common/outbox/outbox.service.ts) with a topic from
  `OutboxTopic` — pass the active `tx`.
- **Queues** for anything heavy: emails, SMS, push, image/video processing, AI, invoices, reports,
  analytics. Never block an API response.
- **Retries:** exponential backoff + jitter, max attempts, timeouts, circuit breaker. Never retry
  infinitely. Repeatedly failing jobs go to a **DLQ** — never silently discarded.
- **Distributed reality:** messages arrive late, twice, and out of order. Never depend on delivery order.
  Consumers are idempotent (outbox delivery is at-least-once).

## 6. Payments & webhooks

- Never trust frontend payment success — it is informational only.
- Verify server-side: webhook signature, amount, currency, customer, payment intent, transaction ID,
  payment status.
- Webhooks are **at-least-once**: the same webhook may arrive multiple times, so handlers are idempotent.
- **Inventory reservation flow:** reserve at checkout → expiration timer → on payment success commit the
  sale → otherwise release inventory. Timer work: `scheduled-transition.worker.ts`.
- **Wallets:** never mutate a balance directly. Maintain wallet + wallet ledger + transactions +
  adjustments + refunds + reconciliation. Every balance change has a ledger entry.

## 7. Security & authorization

- Never trust frontend permissions. Verify **every** action server-side: can this user edit the listing,
  can this seller refund, can this buyer cancel, can this admin impersonate.
- Validate in three layers: request (DTO) → business rules → database constraints.
- Always: input validation, output encoding, parameterized queries, JWT verification, RBAC, Argon2
  password hashing, HTTPS, secure cookies, CSRF protection when using cookies, XSS protection, rate
  limiting, CORS, CSP.
- **Secrets** never hardcoded — env vars / secret manager. Never expose secrets in code, logs, or responses.
- **File uploads** go to object storage, never the app server. Validate MIME type and size; virus scan.

## 8. API contract

RESTful conventions with consistent status codes, error structure, response structure, versioning,
pagination, filtering, sorting.

**Every response uses this envelope — no exceptions.**

```jsonc
// success
{ "status": true,  "message": "...", "data":   { "value": {}, "meta": {} } }
// failure
{ "status": false, "message": "...", "errors": { "value": [], "meta": {} } }
```

This is already centralized — do not hand-roll it:

- Contract: [`src/common/interfaces/api-response.interface.ts`](./src/common/interfaces/api-response.interface.ts)
- Builder: [`src/common/utils/response.util.ts`](./src/common/utils/response.util.ts) (`ResponseUtil`)
- Auto-wrapping: `src/common/interceptors/response.interceptor.ts`
- Failures: `src/common/filters/http-exception.filter.ts` (the only place an error body is written)
- Messages come from a `response-message` constant, **never** a string literal at the call site.

**Message constants are per module.** Every module owns `response/response-message.ts` exporting an
`as const` object split into `success` / `fail`. Cross-cutting messages live in
[`src/common/constants/response-message.ts`](./src/common/constants/response-message.ts).

```ts
// src/modules/users/response/response-message.ts
export const UserResponseMessage = {
  success: { USER_CREATED: 'User created successfully.', USERS_FETCHED: 'Users fetched successfully.' },
  fail: { USER_NOT_FOUND: 'User not found.', EMAIL_ALREADY_EXISTS: 'Email already exists.' },
} as const;

// usage — never an inline string
return ResponseUtil.success(UserResponseMessage.success.USER_CREATED, user);
```

**Versioning:** URI versioning, every route under `/api/v1/...` (`setGlobalPrefix` + `enableVersioning`
in [`src/main.ts`](./src/main.ts)) so a breaking change ships as `/api/v2` while installed app versions
keep working. Health probes are deliberately excluded and never move with a version bump.

**Pagination:** never return unlimited rows. Prefer **cursor/keyset** pagination
([`src/common/pagination/`](./src/common/pagination/)); offset only for admin panels. Metadata field
names are fixed — offset: `page`, `limit`, `total`, `totalPages`, `hasNext`, `hasPrevious`; cursor:
`perPage`, `count`, `nextCursor`, `hasNext`, `hasPrevious`, optional `approxTotal`. Always in
`data.meta`, built by `ResponseUtil.offsetPaginated` / `.cursorPaginated`.

**Search:** use a dedicated engine (OpenSearch/Elasticsearch/Meilisearch) or the maintained
`listing_search` projection. Never `LIKE` for production search.

**Caching:** cache only staleness-tolerant data (products, categories, landing pages). Never cache
wallets, inventory, payments, or orders. Always define the invalidation rule.

## 9. Errors, logging, observability

- Never expose stack traces. Return meaningful business errors; log internal exceptions separately.
- Every request logs: request ID, user ID, correlation ID, execution time, service name, endpoint,
  error code.
- **Audit logs** for every important business action: user ID, action, old value, new value, timestamp,
  IP, request ID. Never lose audit history. Use `src/modules/admin/audit.service.ts`.
- Provide metrics, distributed tracing, structured logs, and health/readiness/liveness checks
  (`src/health/`).

## 10. Performance & scale

Avoid blocking I/O, large transactions, repeated queries, memory leaks. Benchmark expensive operations.
Services are **stateless** and horizontally scalable — multiple instances, distributed workers, no
sticky sessions.

## 11. Code quality

SOLID · DRY · KISS · YAGNI · Clean Architecture · Dependency Injection · Repository pattern · DDD where
appropriate. Reuse the shared primitives in [`src/common/`](./src/common/) instead of reimplementing
them; extend them if they fall short.

**Folder structure.** Cross-cutting code in `src/common/`, features in `src/modules/<module>/`. Each
module is self-contained and owns its own subfolders.

**Subfolders are mandatory — always present, even for a module with a single controller and a single
service.** Never place a controller or service flat at the module root "because there's only one".
Uniformity is the point: every module looks identical, so anyone can find any file without exploring,
and a module that grows never needs restructuring.

```
src/
├── common/            constants/ decorators/ dto/ filters/ interceptors/ interfaces/ utils/
│                      swagger/ pagination/ money/ outbox/ idempotency/ prisma/ errors/ serialization/
├── modules/<module>/
│   ├── controllers/              # <name>.controller.ts — always a folder, never flat
│   ├── services/                 # <name>.service.ts    — always a folder, never flat
│   ├── dto/                      # request DTOs, fully @ApiProperty-documented
│   ├── entities/                 # domain types / API shapes
│   ├── mappers/                  # <name>.mapper.ts — entity → API shape
│   ├── response/response-message.ts
│   ├── guards/ decorators/       # as needed
│   └── <module>.module.ts        # the only file at the module root
└── main.ts
```

The module file is the **only** file allowed at the module root. Mappers are mandatory — never return
a Prisma model directly, or internal columns leak to the client.

Large features ship behind **feature flags** — never deploy unfinished features directly.

## 12. Testing

Every feature includes: unit, integration, transaction, authorization, **race condition**, failure
recovery, and edge case tests. `npm test` (unit) · `npm run test:e2e`.

## 13. Documentation & Swagger

Every module documents: purpose, flow, entities, events, transactions, failure cases, retries,
permissions, dependencies.

**The bar for Swagger:** an Expo developer must be able to integrate an endpoint from `/docs` alone,
without opening backend code. If they'd have to ask a backend question, the docs are incomplete.

**Every endpoint** carries `@ApiTags`, plus `@ApiOperation` with a real multi-line `description` (not a
restated summary) covering what it does, who calls it, and the business rules it enforces — then
`@ApiBody` where there's a payload and the relevant response decorators (`@ApiCreatedResponse`,
`@ApiBadRequestResponse`, `@ApiConflictResponse`, `@ApiUnauthorizedResponse`, …).

Each description states: purpose · auth requirement (public vs Bearer) · required headers · request
body · query and path params · success example · error examples · per-field validation rules ·
pagination behaviour · business rules ("email must be unique", "password ≥ 8 characters").

**Every DTO field** gets `@ApiProperty` with `example` and `description`, and `required: false` when
optional. Never leave a DTO field undocumented.

```ts
@ApiProperty({ example: 'john@example.com', description: 'Unique email address of the user' })
@IsEmail()
email: string;
```

**Controllers** carry a JSDoc block per handler — endpoint, description, used-by (which app screen),
authentication, response shape. **Services** document the numbered steps of the operation, and for
anything transactional: what's inside the transaction, what happens on crash mid-way, and which
outbox topic it emits.

---

## Marketplace concerns to always weigh

Inventory conflicts · double bookings · duplicate orders · duplicate payments · refund consistency ·
commission calculation · wallet reconciliation · coupon abuse · seller authorization · buyer
authorization · marketplace fees · taxes · payout delays · dispute handling · cancellation policies ·
review integrity · fraud prevention.

---

## Commands

```bash
npm run start:dev        # API on :3500, Swagger at /docs
npm run start:worker     # BullMQ workers
npm test                 # unit
npm run test:e2e         # e2e
npm run lint             # eslint --fix
npm run prisma:migrate   # migration (dev)
npm run db:perf          # apply Postgres performance layer (idempotent)
```
