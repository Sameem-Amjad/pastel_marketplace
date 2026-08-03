# Adversarial Audit — Pastel Backend

Three parallel auditors (performance/Postgres, correctness/security, DRY/architecture) reviewed the
~5,400-LOC codebase. Findings below, grouped by status. Severity: 🔴 critical · 🟠 high · 🟡 medium · 🟢 low.

---

## ✅ Fixed in this pass (with proof)

| # | Sev | Finding | Fix | Verified |
|---|-----|---------|-----|----------|
| C1 | 🔴 | `price` sort keyset cast the **column** `price_amount::double precision`, bypassing `listing_search_price` → seq-filter (~1,578 ms, removed 150k rows). | Compare the raw `bigint` column; cast the cursor **value** to the column's native type (`pgType`). `search.service.ts` | `EXPLAIN`: `Index Cond` on `listing_search_price`, **0.034 ms** |
| H1/H2 | 🟠 | Projection trigger fired on **every** `Listing` UPDATE (stockVersion bumps, `updatedAt`), rebuilding the row — ~5× write amplification on the hot stock-CAS path. | Split INSERT/DELETE from UPDATE; UPDATE trigger gated by a `WHEN` clause over the projected columns + the **derived `in_stock` boundary**. `performance.sql` | `ctid` unchanged after stockVersion-only update; changes only on a projected change |
| H4 | 🟠 | Category browse walked the global `created_at` index discarding non-matches. | Added `listing_search (category_l1, created_at DESC, id DESC)`. | index present |
| M3 | 🟡 | `ContentReport`/`RestrictionAppeal`/`Waitlist`/`AccountDeletionRequest` had **zero** indexes beyond PK; admin lists seq-scan. | Added `(status, createdAt)` (and `(status, requestedAt)`) indexes. | schema |
| M4/M5 | 🟡 | Seller dashboard + listing-detail reviews sorted without index support. | Added `Listing(authorId, deletedAt, createdAt)` and `Review(listingId, state, createdAt)`. | schema |
| sec H2 | 🟠 | `OperatorGuard` compared the admin secret with `!==` (timing oracle) and read `process.env` directly. | `crypto.timingSafeEqual` + typed `config.admin.operatorSecret`. `operator.guard.ts` | build |
| sec H6 | 🟠 | No rate limiting anywhere (login/refresh brute-forceable). | `ThrottlerModule` global (120/min/IP) + `@Throttle(10/min)` on login. | build |
| qual H3 | 🟠 | `readCookie` duplicated in `auth.guard.ts` + `auth.controller.ts`. | Extracted `common/http/cookies.util.ts#parseCookie`. | build |
| — | 🟡 | DB integration spec flaked under parallel jest workers. | `test` runs `--runInBand`. | 21/21 pass |

---

## 🔴 Money-path items — MUST fix before real-money launch (planned)

These interlock into one double-charge/lost-money hazard. They need deliberate, larger changes — documented
here rather than rushed. The schema already has the tables to support them (`StripeEvent`, `IdempotencyKey`,
`StockReservation`).

- **C1-sec — Stripe calls run INSIDE the DB transaction + `FOR UPDATE` lock** (`order-state-machine.service.ts`).
  If Stripe succeeds but the commit fails (lock/connection/`outbox` throw), money moved but state rolled back;
  a retry re-runs from the same state. Today only Stripe's own deterministic idempotency keys
  (`pi_/capture_/payout_/refund_<id>`) prevent the double-charge — the DB does not. **Plan:** intent pattern —
  (1) tx: assert state + persist intended action, commit; (2) call Stripe outside the lock with the idempotency
  key; (3) tx: record result + advance state. Never hold a row lock across a network call; add `lock_timeout`.
- **C2-sec — No Stripe webhook handler.** `STRIPE_WEBHOOK_SECRET` is loaded but unused; with automatic capture +
  SCA, PIs/refunds/transfers/disputes/`account.updated` finalize async and are never reconciled. **Plan:**
  `POST /stripe/webhook` with raw-body `constructEvent`, dedup on `StripeEvent.id`, reconcile PI/charge/transfer/
  dispute/account events.
- **C3-sec — Inbound idempotency built but unwired.** `IdempotencyService` exists; no controller uses it. A
  double-tap of `POST /checkout` creates two orders → two PaymentIntents → two real charges. **Plan:**
  idempotency interceptor on checkout/confirm/refund keyed on the `Idempotency-Key` header; reject a new
  checkout when a non-terminal order already exists for (customer, listing).
- **H3-sec — Overselling: no stock reservation/decrement at checkout.** Checkout never reads/reserves stock;
  the stock CAS is a separate seller endpoint. Infinite buyers can pay for 1 unit. Quantity has no upper bound.
  **Plan:** in the checkout tx, `FOR UPDATE` the listing, re-assert published+not-deleted, create a
  `StockReservation` (15-min hold) / CAS-decrement before the PaymentIntent; release on expire/cancel/refund.
  Add a max-quantity DTO bound.

## 🟠 Security — high (planned)

- **H1 — Access tokens are effectively unrevocable.** `ver` claim is signed (always 0) but never checked;
  `AuthGuard` doesn't re-check `accountStatus`. A banned user keeps full access for up to `accessTtl` (15 min);
  logout only revokes the refresh token. **Plan:** persist `User.tokenVersion`, compare in `verifyAccess`
  (cached lookup), bump on ban/logout-all; re-check `accountStatus` on sensitive mutations; shorten access TTL.
- **H4 — CSRF configured but not enforced.** `csrfSecret`/`X-CSRF-Token` exist but no check; cookie mutations
  rely on `SameSite=Lax` alone. **Plan:** double-submit CSRF on cookie-auth mutations, or require a header token
  (not cookie) for mutations; tighten the CORS origin regex (audit trusted subdomains).
- **M2-sec — `confirm-payment` reachable via generic `/orders/:id/transitions/:name`** bypassing
  `@RequirePermission('initiateTx')`. **Plan:** enforce the permission inside the FSM for money actions.
- **L4-sec — refresh rotation reuse-check is not row-locked** (`token.service.ts`): a narrow concurrent-use
  window exists before family-burn. **Plan:** wrap rotate in a tx with `SELECT … FOR UPDATE` on the credential
  (or conditional `updateMany` + treat `count===0` as reuse).

## 🟡 Performance / architecture (planned)

- **C2-perf — `sort=relevance` can't be index-ordered** (ranked FTS); seq-scans on broad keywords. Bounded-depth
  by design; the documented seam to OpenSearch/Typesense (doc 05 Phase B). Comment added; cap depth next.
- **H5-perf — Stripe call inside the order lock window** (same root as C1-sec).
- **M1-perf / qual-H1 — Follow/like update hot counter rows on the wide `User`/`Story` tuple, and Social WRITES
  `User` directly (module-boundary violation).** **Plan:** an Identity-owned, tx-aware `UserCounterService`
  (narrow counter table) that Social calls — fixes contention AND the boundary in one move.
- **qual-M1 — Keyset WHERE-seek builder re-implemented in 6+ services.** **Plan:** add `keysetWhere()` to
  `cursor.util.ts`; collapse admin/social/notifications onto it (compose via `AND:[...]`, per `M4`).
- **qual-M2/M3 — List service signatures + `Page` mapping diverge** across agent-built modules. **Plan:**
  standardize on a DTO arg + a shared `mapPage()`.
- **perf-M2 — `listOwn`/stories/highlights lack pagination.** **Plan:** apply the keyset helper.

## 🟢 Verified GOOD (no change)

- **No SQL injection** — every user value in `search.service.ts` is a bound parameter; `sort` is `@IsIn`-constrained
  and switch-mapped. Money math (HALF_UP, sign conventions, includeFor sums) verified correct. IDOR posture solid
  (party/owner checks throughout; `markRead` re-scoped to recipient). Mappers never leak
  passwordHash/privateData/clientSecret. Read/write replica split applied consistently. Partial indexes and
  notification dedup are well-chosen. Keyset cursor correctness verified across tied sort values.
