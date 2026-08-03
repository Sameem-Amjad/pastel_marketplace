# 07 — Migration & Delivery Plan

> How we build the new backend, move the data off Sharetribe + Firebase, run both safely in parallel, cut over, and roll back if needed. Plus risks, team, and a rough estimate.

> Per your direction, the existing repo/app keeps running unchanged while we build. Cutover is a deliberate, later event — this plan makes it safe when you choose to pull the trigger.

---

## 1. Strategy: build standalone → backfill → dual-run → cut over (strangler)

```
 Phase 0   Phase 1            Phase 2            Phase 3          Phase 4         Phase 5
 Setup  →  Core platform  →  Catalog+Search  →  Orders+Payments → Social/Notif  → Cutover
           (auth, data,       (read path can     (the hard part,    +Live+Admin     (frontend
            config)            dual-run reads)    incl. Stripe)      +backfill all   swaps SDK,
                                                                     data)           Sharetribe off
```
We do **not** flip everything at once. The new backend is built and validated module-by-module, data is backfilled continuously, and the read path can be served from the new backend (shadow/dual-run) before any writes cut over. The order/payments cutover is the one true "big bang" moment (you can't half-own payments) and gets the most rehearsal.

---

## 2. Data migration

### 2.1 Sources & extraction
| Source | How to extract | Notes |
|---|---|---|
| **Sharetribe** users/listings/transactions/reviews/messages/stock | **Integration API** (`sharetribe-flex-integration-sdk`) — `users.query`, `listings.query`, `transactions.query` (paginated, `per_page:100`), `events.query` for incremental | Read-only; we already use this SDK in `admin-*.js`. |
| **Firestore** follows/stories/highlights/notifications/discounts/shows/analytics/waitlist/reports/appeals/tracking | Firestore export (`gcloud firestore export`) or Admin SDK paged reads | Named DB `pastel` / `pastel-dev`. |
| **Object storage** listing images (Sharetribe CDN), story/profile media (Firebase Storage) | Download originals; re-upload to our object storage; record `MediaAsset` | Sharetribe image originals: pull via image API; generate variants on our side. |
| **Stripe** | **Special — see §2.4** | The hard one. |

### 2.2 ETL approach
- A standalone **migration toolkit** (NestJS CLI / scripts) reading source APIs → mapping → Prisma upserts, keyed by **stable external ids** (store `sharetribeId`/`firestoreId` on each new row during migration for idempotent re-runs and reconciliation).
- **Idempotent + resumable:** every entity upsert keyed by source id; safe to re-run; checkpoint cursors persisted.
- **Order of load:** users → categories/config → listings (+images/stock) → collections → orders (+line items, transitions, messages, reviews) → social → notifications/prefs/tokens → promotions → shows → ops/analytics.
- **Extended-data mapping:** promote known `publicData`/`privateData`/`protectedData` keys into typed columns (doc 02); keep the remainder in the JSONB buckets. The audits enumerate the exact keys.
- **Field cleanups during migration:** normalize timestamps to `timestamptz`; reconcile `listingId` vs `listingID`, `sellerNote` vs `sellerNotes`; drop the dead `firebase` client dep and stale debug collections.

### 2.3 Incremental sync (keep new DB fresh during dual-run)
- Sharetribe: poll `events.query` (transaction/listing/user events) on a cursor (we already do this in `sharetribe-events-poll.js`) → apply deltas to Postgres. Keeps the new DB current until cutover so the backfill isn't stale.
- Firestore: periodic delta reads by `updatedAt`.

### 2.4 Stripe migration — the critical constraint
Today **Sharetribe owns the Stripe platform account**; seller Connect accounts and the escrow balance live under *Sharetribe's* platform, not ours. This cannot be silently transferred. Plan:
1. **Stand up our own Stripe platform** (Connect). Seller Connect accounts under Sharetribe's platform are **not** ours.
2. **Seller re-onboarding:** sellers must onboard onto our platform (`accounts.create` + account link). Drive this with an in-app campaign *before* cutover; track completion via `StripeAccount.payoutsEnabled`. (Investigate Stripe's cross-platform account-migration/copy options with Stripe support — possible for some configurations but not guaranteed; assume re-onboarding.)
3. **Drain in-flight money before cutover:** let escrowed Sharetribe transactions reach a terminal state (payout or refund) under the old system, or migrate only *settled* history. **Do not** try to move live payment intents/held funds between platforms.
4. **Cutover rule:** new orders → new Stripe platform; existing in-flight orders → finish on the old system. A short **"new checkout paused for legacy in-flight only"** window minimizes straddling state.
5. Saved buyer cards (Stripe Customers under Sharetribe's platform) likewise don't transfer — buyers re-add cards, or use Stripe's PaymentMethod-clone where eligible. Plan for re-entry.

This is the single biggest cutover risk; §6 treats it as such.

### 2.5 Validation / reconciliation
- Row counts per entity (source vs target) within tolerance.
- **Financial reconciliation:** replay a representative sample of historical transactions through the new pricing + state engine; assert identical line items, payin/payout, final state (doc 04 §9). Money must reconcile to the cent.
- Spot-check listings render identically (images, variants, fields).
- A reconciliation report signed off before cutover.

---

## 3. Phased delivery (build order)

> Rough sizing assumes a small senior team (see §5). Phases overlap where safe.

### Phase 0 — Foundations
NestJS skeleton, Prisma + Postgres (dev/staging/prod), Redis/BullMQ, CI/CD, observability, secrets, base auth scaffolding, outbox + scheduler primitives, migration-toolkit skeleton.

### Phase 1 — Identity & Config
Auth service (signup/login/refresh/OAuth/native bridge/scopes/permissions — doc 06), `/me`, config/CMS service (doc 03 §11). Backfill users + config. **Validate native auth cold-start** on real devices.

### Phase 2 — Catalog & Search
Listing CRUD + lifecycle + stock CAS, categories, collections, media/variants, reviews, AI generation. `listing_search` projection + Postgres search (doc 05). Backfill listings + images. **Dual-run reads:** serve search/detail from the new backend in shadow and diff against Sharetribe before trusting it.

### Phase 3 — Orders, Payments, Tax (the hard core)
Pricing engine (unit-tested to parity), state-machine engine + `instant-purchase` + `cart-stock` + `default-purchase` + `inquiry`, `ScheduledTransition` worker, **direct Stripe Connect** (onboarding, customer/cards, PI+capture, payout/escrow, webhooks), refunds/disputes, TaxJar, Shippo. Seller re-onboarding campaign begins. Financial reconciliation harness.

### Phase 4 — Social, Notifications, Live, Admin
Follow/stories/highlights/likes/favorites/handles; notifications + push (outbox→FCM) + email + reminders; live-show proxy/index/grace sweeper; admin/ops/compliance/analytics. Backfill all Firestore business data. Decommission the Firebase Cloud Functions (their logic now lives in NestJS workers; FCM transport stays).

### Phase 5 — Cutover & hardening
Final incremental sync, reconciliation sign-off, frontend SDK-adapter swap (doc 06 §4) in the (separate, future) frontend change, Sharetribe set read-only then retired, load test at 1M+ listings, runbooks, on-call.

---

## 4. Cutover & rollback

### Cutover sequence (the big moment)
1. Freeze new sign-ups/listings briefly (or dual-write) to bound drift.
2. Final incremental sync; run reconciliation; sign off.
3. Set Sharetribe to read-only (stop new writes there).
4. Point the frontend SDK-adapter at the new backend (config flag / deploy). For native this ships via **OTA** for the web bundle; verify cold start.
5. New checkouts → new Stripe platform. Legacy in-flight orders continue finishing on the old path until drained.
6. Monitor intensively (auth success, checkout success, payout/refund success, search latency, error rate).

### Rollback
- **Before payments cutover:** trivial — flip the adapter back to Sharetribe; the new backend was read/shadow only.
- **After payments cutover:** hard. Mitigate with: a tested feature-flag to route checkout back to Sharetribe (kept warm for a defined window), the drain rule (no straddling money), and a "stop new orders" kill-switch. Orders already created on the new platform stay there; only the routing flips. Rehearse this in staging.
- Keep Sharetribe subscription active and read-only for a defined safety window post-cutover.

---

## 5. Team, sequencing, estimate

> Order-of-magnitude for planning, not a commitment. Assumes ~3–5 senior engineers, a payments specialist, and a DevOps/SRE. Calendar, not effort.

| Phase | Focus | Rough duration |
|---|---|---|
| 0 | Foundations | 2–4 weeks |
| 1 | Identity + Config | 4–6 weeks |
| 2 | Catalog + Search | 6–8 weeks |
| 3 | Orders + Payments + Tax | 10–14 weeks (critical path) |
| 4 | Social + Notif + Live + Admin | 6–8 weeks (parallelizable) |
| 5 | Cutover + hardening | 3–5 weeks |
| | **Total (with overlap)** | **~7–10 months** |

Critical path is **Phase 3** (state machine + Stripe + reconciliation). Phases 2 and 4 parallelize across the team. Front-load: pricing-engine parity tests, the auth cold-start contract, and the Stripe re-onboarding strategy — these de-risk the whole program.

---

## 6. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Stripe platform migration** — Connect accounts/escrow/cards don't transfer between platforms | 🔴 Critical | Re-onboard sellers pre-cutover; drain in-flight money on old system; no straddling; engage Stripe support early (§2.4). |
| R2 | **Auth regression** → total cold-start lockout (esp. native) | 🔴 Critical | Preserve scope/transport/boot-order semantics (doc 06 §7); device cold-start tests in CI; staged rollout; `.claude/rules/auth-sensitive.md`. |
| R3 | **Money math drift** vs Sharetribe | 🔴 Critical | Port pure pricing fns verbatim; cent-level reconciliation harness; replay historical tx (doc 04 §9). |
| R4 | **State-machine timer gaps** (lost auto-cancel/payout/expiry) | 🟠 High | `ScheduledTransition` + guarded idempotent worker; alert on overdue timers; reconcile against EDN. |
| R5 | **Search relevance/perf** worse than Sharetribe | 🟠 High | Postgres FTS + trigram tuning; load test 1M+; Phase-B engine ready behind the same interface (doc 05). |
| R6 | **Data loss / mismatch** during ETL | 🟠 High | Idempotent keyed upserts; incremental sync; reconciliation report sign-off; keep Sharetribe read-only post-cutover. |
| R7 | **Hosted-config divergence** (listing fields/categories/branding now DB-backed) | 🟡 Med | Migrate config assets 1:1; keep `mergeConfig` shape; snapshot-diff config rendering. |
| R8 | **Webhook reliability** (new responsibility) | 🟡 Med | HMAC + `StripeEvent` dedupe + retry; reconcile via polling fallback. |
| R9 | **Media variant parity** (CDN/imgix replacement) | 🟡 Med | Preserve `{w,h,fit}` contract; pre-generate hot variants; CDN cache. |
| R10 | **Scope creep** from dormant features (booking) | 🟢 Low | Explicitly deferred (doc 03 §15); schema seam only. |
| R11 | **External tools repo** reads Firestore directly (analytics, reports, deletion queue) | 🟡 Med | Coordinate that reader: expose equivalent APIs or dual-write during transition. |

---

## 7. Definition of done (per phase)

- All FRs for the phase implemented + unit/integration tested (Testcontainers on real Postgres).
- Data backfilled + reconciled for the phase's entities.
- Observability: dashboards + alerts live for the phase's SLOs.
- Runbook written (deploy, rollback, on-call for that subsystem).
- For Phase 3: financial reconciliation signed off; Stripe webhooks verified end-to-end in staging.
- For Phase 5: native cold-start auth verified on device; load test at target scale passed; rollback rehearsed.

---

## 8. Immediate next steps (first 2 weeks)

1. Stand up the NestJS + Prisma + Postgres + Redis skeleton and CI/CD (Phase 0).
2. Implement the **pricing engine** as pure functions with a parity test suite against current `lineItems.js`/`cartLineItems.js` outputs (highest-value de-risk).
3. Prototype the **auth service** + native cold-start contract on a test device.
4. Open the **Stripe platform** account and start the seller re-onboarding design + Stripe-support conversation (longest-lead-time risk).
5. Build the **migration-toolkit skeleton** + a read-only Sharetribe/Firestore extractor to validate data shapes against doc 02.
