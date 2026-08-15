# Pastel — NestJS Backend Platform

**Architecture & System Design — Replacing Sharetribe Flex**

| | |
|---|---|
| **Status** | Draft v1.0 — for review |
| **Author** | Platform / Architecture |
| **Date** | 2026-06-25 |
| **Scope** | Greenfield NestJS + PostgreSQL backend that re-implements **all** functionality currently provided by Sharetribe Flex, the existing Express server, and the Firebase-backed business features. |
| **Non-goal** | We do **not** modify the existing marketplace repository. This is a new, standalone backend; the existing app stays running until cutover. |

---

## 1. Why this document set exists

Pastel is a live, multi-vendor marketplace (web + native iOS/Android via Capacitor) currently built on **Sharetribe Flex**. Sharetribe is the system of record for users, listings, transactions, payments (it brokers Stripe), search, and auth. A parallel set of social/commerce features lives in **Firebase/Firestore** (follows, stories, notifications, discounts, live-show index, analytics).

We are replacing Sharetribe with a backend we own: **NestJS + PostgreSQL + Prisma**, designed to scale to **millions of listings**. Because Sharetribe does so much for us invisibly, removing it means re-building a large surface area: a transaction state-machine engine, direct Stripe Connect integration, a pricing/commission/tax engine, a search platform, an identity/auth service, image processing, and a config system — plus the Firebase features.

This document set is the blueprint for that build.

---

## 2. Locked decisions (confirmed)

| Decision | Choice | Rationale |
|---|---|---|
| **Language/Framework** | TypeScript + **NestJS** | Opinionated DI, modules, guards/interceptors map cleanly onto our domain boundaries. |
| **Database** | **PostgreSQL 16+** | Relational integrity for money/orders, rich indexing (GIN, GiST), PostGIS, JSONB for the long tail. |
| **ORM** | **Prisma** | Best-in-class DX + type safety + migrations. Raw-SQL escape hatch for hot read paths. |
| **Search** | **Postgres-first** (`tsvector`+GIN, `pg_trgm`, PostGIS), add **OpenSearch/Typesense later** via outbox/CDC | Launch on one system; introduce a dedicated engine only when facet QPS/relevance demands it. |
| **Topology** | **Modular monolith** | One deployable NestJS app with strict module seams. Extract services later only where scaling demands. |
| **Scope** | Re-implement **all** functionality in the new backend (Sharetribe + Express + Firebase business data). | Single owned platform. |
| **Kept external** | **Firebase Cloud Messaging** (push transport — the *only* Firebase product retained), **S3-compatible object storage** (media — not Firebase Storage), **LiveKit orchestrator** (`api.ivector.co`), **Mailgun**, **TaxJar**, **Shippo** | Commodity/working integrations; no value in replacing now. |
| **Firebase boundary** | Firebase is used **only for FCM push**. Firestore → PostgreSQL · Firebase Storage → S3-compatible · Cloud Functions → BullMQ workers/cron · Admin SDK → removed. | Mobile push requires FCM at the OS level; everything else is off Firebase. |
| **Native push** | FCM integrated via the **official Firebase native SDKs** (iOS + Android) + a custom Capacitor bridge — **not** the `@capacitor-firebase/*` plugins. | Backend contract unchanged (FCM HTTP v1 + `PushToken`); native swap is a 🔴 IPA/APK rebuild. |

---

## 3. Document map

Read in order; each builds on the last.

| # | Document | What it covers |
|---|---|---|
| 00 | **This README** | Scope, decisions, glossary, the "what Sharetribe does for us" inventory. |
| 01 | [`01-architecture-and-system-design.md`](./01-architecture-and-system-design.md) | Target architecture, tech stack, modular-monolith module map, deployment topology, cross-cutting concerns, key sequence diagrams. |
| 02 | [`02-data-model.md`](./02-data-model.md) | Complete PostgreSQL schema (Prisma models) for every domain: identity, catalog, orders, payments, social, notifications, config. |
| 03 | [`03-functional-requirements.md`](./03-functional-requirements.md) | The **full inventory** of functionality to re-implement, organized by module, traced back to the current code. |
| 04 | [`04-transactions-payments-tax.md`](./04-transactions-payments-tax.md) | The order state-machine engine, **direct Stripe Connect** (escrow model), pricing/commission engine, refunds/disputes, TaxJar, Shippo. |
| 05 | [`05-search-and-scaling.md`](./05-search-and-scaling.md) | Search platform for **millions of listings**, indexing, cursor pagination, caching, read replicas, partitioning, capacity model. |
| 06 | [`06-auth-and-api-contract.md`](./06-auth-and-api-contract.md) | Identity/auth service (replacing Sharetribe auth, OAuth, native tokens, scopes/permissions) + the external API contract + frontend integration strategy. |
| 07 | [`07-migration-and-delivery-plan.md`](./07-migration-and-delivery-plan.md) | Data migration from Sharetribe + Firebase, phased delivery, dual-run/backfill, cutover, rollback, risks, team & estimate. |
| 08 | [`08-45-day-execution-plan.md`](./08-45-day-execution-plan.md) | The 45–50 day, 3-engineer execution plan for building the new platform (leadership-facing). |
| 09 | [`09-coverage-matrix.md`](./09-coverage-matrix.md) | **Coverage matrix & readiness sign-off** — proof (via multi-agent audit) that the docs capture 100% of the current system, the gap-closure log, and the open business decisions. **Read this to confirm we're ready to build.** |
| 10 | [`10-api-response-standard.md`](./10-api-response-standard.md) | **The implemented wire contract** — the `{ status, message, data \| errors }` envelope, per-module response messages, pagination meta, Swagger conventions, `/api/v1` versioning. Supersedes the RFC-7807 error format in doc 06. **Read before adding an endpoint.** |

---

## 4. What Sharetribe does for us today (the replacement surface)

This is the headline of the whole effort. Everything below is "free" today and must be built.

| Capability Sharetribe provides | We must build |
|---|---|
| **System of record** for users, listings, transactions, reviews, messages, stock | Postgres schema + services (docs 02, 03) |
| **Transaction processes** (EDN state machines: `instant-purchase`, `default-purchase`, `cart-stock`, `default-inquiry`, dormant `default-booking`) with **time-based transitions** (PT15M, P3D, P7D, P14D, P60D) | Order FSM engine + scheduler (doc 04) |
| **Stripe brokering** — payment intents, confirm/capture, **Connect payouts (escrow)**, refunds, application fees | Direct Stripe Connect integration + webhooks (doc 04) |
| **Privileged pricing** — server-side line items, commission, tax, promo math (the financial trust boundary) | Pricing engine (doc 04) |
| **Listing query API** — indexed extended-data filters, multi-enum `has_all`/`has_any`, ranges, **full-text keywords**, **geo** (origin+bounds), sort, pagination | Search platform (doc 05) |
| **On-the-fly image variants** + CDN (`imageVariant.<name>` → `{w,h,fit}`) | Object storage + image-resize + CDN (docs 01, 05) |
| **Auth** — email/password, social IdP (Google/Apple/Facebook), token exchange (trusted scope), `loginAs`, password reset, email verification | Identity service (doc 06) |
| **Hosted config & assets** — listing types/fields, categories, search config, user types, branding, translations, commission.json, CMS pages | Config service (doc 03) + DB-backed config |
| **JSON:API response shape** (`{data, included, meta}`, UUID-as-`{uuid}`, `Money{amount,currency}`) that the entire React frontend's normalization layer depends on | API compatibility adapter (doc 06) |

Plus the **Express server** responsibilities (~80 endpoints) and **Firebase business data** (follows, stories, highlights, notifications, discounts/promotions, live-show index, analytics, waitlist, content reports, restriction appeals, order tracking) — all re-homed into the new backend (docs 02, 03).

---

## 5. Guiding principles

1. **Money is never computed or trusted from the client.** All pricing, commission, tax, and refund math is server-authoritative, integer-cents, `decimal.js`-style rounding (HALF_UP). See doc 04.
2. **The order lifecycle is an explicit, audited state machine.** Every transition is a row; every money action is idempotent and tied to a Stripe object. See doc 04.
3. **Postgres is the single source of truth.** Search indexes, caches, and (later) search engines are derived and rebuildable. See doc 05.
4. **Scale by read/write separation, not premature microservices.** Cursor pagination, read replicas, derived search docs, caching — before we split the monolith. See doc 05.
5. **Frontend changes are minimized at cutover** by serving a Sharetribe-compatible response shape behind an SDK-shaped adapter, then modernizing the contract post-cutover. See doc 06.
6. **Auth is the highest-risk subsystem.** Preserve scope semantics (public-read vs user vs trusted), the dual cookie/native-token transport, and the `authInfo`-before-`fetchCurrentUser` boot ordering. See doc 06.

---

## 6. Glossary

| Term | Meaning |
|---|---|
| **Flex / Sharetribe** | The marketplace SaaS we are replacing. |
| **Marketplace SDK** | `sharetribe-flex-sdk` — used in the browser and server with a user token. |
| **Integration SDK** | `sharetribe-flex-integration-sdk` — server-only operator/admin API. |
| **Extended data** | Sharetribe's `publicData` / `privateData` / `protectedData` / `metadata` JSON buckets on users/listings/transactions. |
| **Transaction process** | A Sharetribe state machine defined in EDN (`ext/transaction-processes/*`). |
| **Privileged transition** | A state transition that runs server-side with a trusted token (sets line items, charges, refunds). |
| **Money** | Sharetribe SDK type: integer **subunit** amount + currency (e.g. `{amount: 1599, currency: 'USD'}` = $15.99). |
| **Escrow** | Captured funds held on the platform Stripe balance until the buyer confirms receipt, then paid out to the seller. |
| **OTA** | Over-the-air web bundle delivery to installed native apps (see `docs/OTA_ARCHITECTURE.md`). |
| **Outbox** | Transactional outbox pattern: write domain events to a Postgres table in the same tx, then relay to search/push/webhooks. |

---

## 7. How to use this set

- **Engineering leads / architects:** read 01 → 04 → 05 → 06.
- **Backend implementers:** 02 (schema) + 03 (what to build) + the relevant deep-dive (04/05/06).
- **PM / delivery:** 00 + 07 (plan, risks, estimate).
- The audits these documents are built on were performed at code level against the live repo on 2026-06-25; file/line references in docs 03–06 point into the existing codebase as the source of truth for behavior.
