# 08 — Building Pastel's New Platform: A 45–50 Day Plan (the new full-fledged backend)

> **Purpose:** a realistic, defensible delivery plan to build Pastel's own next-generation backend (NestJS + PostgreSQL) from the ground up — properly engineered, with **full feature parity** for everything the product does today — executed by a 3-person team in 45–50 days with AI-assisted development (Opus 4.8). The current Sharetribe-based system is the legacy platform the new version supersedes; it keeps running alongside as a safety net until the new version is ready. Written for leadership review.

| | |
|---|---|
| **Window** | 45 to 50 calendar days (3 × 2-week sprints + an 8-day stabilization & hardening phase) |
| **Team** | 1 Senior Backend · 1 Mobile (iOS + Android) · 1 Web — all senior, AI-assisted |
| **Outcome by Day 50** | A **complete, parity-validated new platform running in staging**, with the entire marketplace working end-to-end on web + native, all data migrated, and a **controlled switch-over to the new version ready to execute** — with the legacy Sharetribe system running in parallel as the safety net. |
| **Stack** | NestJS · PostgreSQL + Prisma · Redis/BullMQ · Postgres-first search · Stripe Connect (direct) |

---

## 1. Executive summary

We are building **Pastel's own next-generation backend** (NestJS + PostgreSQL) — a full-fledged new version of the platform that we own and control end to end. This is not a patch or a lift-and-shift: it is the product built **the proper way**, with **complete feature parity** for every functionality the current product has today — identity, catalog, search, orders, payments, social, notifications, admin, live shows. With AI-assisted development, a focused 3-person senior team builds the entire core platform and migrates all data within 45–50 days, validated in a staging environment against the live system. The legacy Sharetribe system is simply the system the new version replaces; it stays live as a safety net until we switch over.

**The 45–50 day window produces a production-grade, fully-validated new platform in staging, built properly, with all functionality of the current product covered. The real-money switch-over to the new version is then executed as a tightly-controlled go-live, while the legacy Sharetribe app keeps serving customers throughout — so there is zero downtime risk and a one-click rollback until we are 100% confident.** This staged approach is deliberate: it is the only way to swap the payments and identity backbone of a live marketplace without risking orders, money, or customer lockout.

This plan is aggressive but achievable **under the assumptions in §9**. It depends on scope discipline (§4), AI leverage on boilerplate (§3), and the parallel switch-over activities (§10) starting on Day 1. The headline for leadership: **we are building our own full-fledged platform, properly, in 45–50 days, with complete feature parity — then switching over safely.**

---

## 2. What "done in 45–50 days" means (and does not)

Being explicit protects the plan and sets correct expectations.

| ✅ Delivered by Day 50 | ⏭️ Immediately after (staged switch-over, legacy system still live) |
|---|---|
| Full new platform (all core modules, full feature parity) running in **staging** | Real-money switch-over to the new version |
| All historical data migrated + reconciled | Seller **Stripe re-onboarding** completion (external, runs in parallel from Day 1) |
| Web + native apps working against the new platform in staging | Final financial reconciliation **sign-off** |
| Stripe Connect proven end-to-end in **test mode** | Security review + UAT with real sellers |
| Pricing parity validated to the cent | Legacy Sharetribe decommission (after safety window) |
| Switch-over runbook + rollback rehearsed | |

**Why the switch-over is staged, not on Day 50:** the legacy Sharetribe system currently *owns* the Stripe platform — your sellers' payout accounts and escrow balances live under Sharetribe and **cannot be transferred by code**. Sellers must re-onboard onto our new Stripe platform (a communications campaign, not an engineering task), and in-flight escrowed money must settle on the old system first. This is calendar-bound and runs in parallel; it gates the switch-over, not the build of the new platform.

---

## 3. Operating model (how 3 people deliver this)

- **AI-assisted development (Opus 4.8 / Claude Code)** is the force multiplier. It writes the high-volume, mechanical ~60–70% of the code — Prisma schema, CRUD endpoints, DTOs, guards, tests, data-migration scripts, social/notification/admin modules — at multiples of hand-coding speed. Engineers spend their time on **design, correctness, integration, and verification** (the order state machine, Stripe, auth, reconciliation), which AI accelerates less.
- **The architecture is already designed** (docs 01–07 in this folder): schema, module map, FSM design, Stripe model, search, auth, migration. The team executes a blueprint built the proper way rather than discovering it — a large time saving.
- **Scope discipline is enforced.** The bar is full parity with today's product (§4); anything beyond that is deferred. No gold-plating.
- **Daily integration.** One trunk, CI on every push, feature flags, staging deployed continuously.
- **The legacy Sharetribe system stays untouched and live** the entire window — the new version is built alongside it.

---

## 4. Scope

### In scope (full feature parity — the entire current marketplace, working end-to-end)
- **Identity & Auth:** email/password, Google/Apple/Facebook, native token transport + cold-start, scopes/permissions, password reset, email verification, `/me`.
- **Catalog:** listing CRUD + lifecycle, stock (CAS), categories, collections, reviews, media/image variants, AI listing generation.
- **Search:** Postgres faceted search (filters, full-text, price, sort, cursor pagination, stock filter).
- **Orders:** `instant-purchase` + `cart-stock` processes, cart, checkout (speculate/confirm), messaging, the state-machine engine + scheduled transitions, basic dispute/refund operator path.
- **Pricing:** line items, commission, tax, promos — server-authoritative, parity-tested.
- **Payments:** Stripe Connect direct — seller onboarding, customer/cards, PaymentIntent + capture + escrow + payout + refunds + webhooks (test mode in window).
- **Tax & Shipping:** TaxJar rates/reporting, Shippo rates/labels/tracking.
- **Social:** follow/followers, stories (+expiry), highlights, likes, favorites, handles.
- **Notifications:** in-app feed, preferences, push via FCM, transactional email.
- **Admin/Ops:** user management, refunds console, restriction appeals, content reports, account deletion, analytics, config/CMS service.
- **Live shows:** orchestrator proxy + Postgres index + grace sweeper (thin — orchestrator unchanged).
- **Data migration:** all users/listings/orders/reviews/messages + all Firebase business data.
- **Frontend integration:** SDK-adapter so web + native talk to the new platform with minimal change.

### Deferred / out of scope for the 45–50 days
- Booking process (`default-booking`) — dormant; schema seam only.
- Phase-B dedicated search engine (OpenSearch/Typesense) — Postgres is enough now.
- `default-purchase` legacy process — only if legacy orders require it (else handle via migration freeze).
- Multi-currency beyond today's operational currency.
- Team/multi-user seller accounts.
- Non-essential admin reporting that the external tools service already covers.

---

## 5. Sprint plan

> 3 sprints of 2 weeks + an 8-day stabilization & hardening phase. Each sprint ends with a working, demoable increment of the new platform in staging. **B** = Backend, **W** = Web, **M** = Mobile.

### Sprint 1 — Days 1–15: Foundation, Identity, Catalog
**Goal:** infra up, auth working on all clients, listings + search live in staging, data extraction validated.

| Owner | Tasks |
|---|---|
| **B** | NestJS+Prisma+Postgres+Redis skeleton, CI/CD, observability, secrets · full Prisma schema (doc 02) · **Auth/identity service** (signup/login/refresh/OAuth/native bridge/scopes/permissions, `/me`) · **Catalog** (listing CRUD+lifecycle, stock CAS, categories, collections, media) · **Postgres search** projection + query API · **Config/CMS** service · **Migration toolkit** + Sharetribe/Firestore extractors · backfill users + listings + config into staging. |
| **W** | **SDK-adapter** scaffolding (the seam that points the React app at the new platform) · wire **auth flows** (login/signup/social/reset) to new endpoints · re-point **config/asset loading** · wire **search + listing detail + profile** read pages · keep JSON:API shape compatibility. |
| **M** | **Native auth cold-start** + token transport (`X-Native-Token`) against the new platform — *the single highest native risk, front-loaded* · OAuth deep-link bridge · build dev native app pointing at staging · verify boot ordering on real iOS + Android devices. |

**Sprint 1 demo:** log in (web + native, all providers), browse/search listings, view listing + profile — all served by the new platform in staging.

### Sprint 2 — Days 16–30: Orders, Payments, Tax, Shipping
**Goal:** full purchase flow works end-to-end in staging on Stripe test mode, prices parity-validated.

| Owner | Tasks |
|---|---|
| **B** | **Pricing engine** (port pure functions) + **cent-parity test suite** vs current outputs · **State-machine engine** + `instant-purchase` + `cart-stock` + **ScheduledTransition worker** (timers) · **Stripe Connect** (onboarding, customer/cards, PaymentIntent+capture+escrow+**payout**, **webhooks**) · **refunds/disputes** operator path + eligibility + speculative-commit · **TaxJar** + **Shippo** · cart service. |
| **W** | Wire **cart → checkout → payment (Stripe.js) → order/transaction page** · seller **Stripe onboarding** + payment-methods UI · order management (buyer orders / seller sales) · messaging · reviews. |
| **M** | Device QA of checkout/Stripe + Apple/Google pay surfaces in WebView · native camera/upload flows for listing creation against new media endpoints · **integrate FCM via the official Firebase native SDKs** (iOS + Android) + custom Capacitor bridge, replacing the `@capacitor-firebase/*` plugins — 🔴 native rebuild · register device token to `/push/token`. |

**Sprint 2 demo:** end-to-end purchase (cart → pay → seller payout on receipt) in staging on Stripe test mode; refund from the admin path; tax + shipping correct.

### Sprint 3 — Days 31–42: Social, Notifications, Admin, Live, Full Migration
**Goal:** feature-complete (full parity); all data migrated; the full app working on web + native in staging.

| Owner | Tasks |
|---|---|
| **B** | **Social** (follow, stories+expiry, highlights, likes, favorites, handles) · **Notifications** (feed, prefs, **push fan-out → FCM**, email + reminders, outbox worker) · **Admin/Ops** (user mgmt, refunds console, appeals, reports, deletion, analytics) · **Live shows** proxy/index/grace sweeper · **backfill all Firebase data** + incremental sync · reconciliation harness (replay historical orders). |
| **W** | Wire social (profiles/stories/highlights/follow), notifications center, shop manager (products/orders/earnings/collections/settings), live-show pages, admin surfaces · full-app regression. |
| **M** | Native stories/highlights creation + camera/video upload + thumbnails · push display + deep links (via the native Firebase SDK integration) · OTA bundle pipeline validated · store-build (new Firebase native SDK requires a fresh IPA/APK) · full native regression. |

**Sprint 3 demo:** the entire app — buy, sell, social, live, notifications, admin — running on the new platform in staging on web + native, with migrated data: full feature parity demonstrated.

### Stabilization & hardening — Days 43–50
- Bug bash + load test at scale (1M+ synthetic listings) · security pass · finalize **financial reconciliation report** · **switch-over runbook + rollback rehearsal** · parity verification across every module · sign-off review with leadership. The extra days (43–50) are deliberate buffer for hardening, edge-case polish, and final parity validation — protecting quality at the finish line rather than rushing the last mile.

---

## 6. Responsibilities by track

| Track | Primary ownership | Bus-factor note |
|---|---|---|
| **Backend (1)** | Everything server-side — the critical path. AI-assisted to sustain the volume. | **Single point of failure.** Mitigations in §8 (R1). The architecture docs + AI assistance reduce, but do not remove, this risk. |
| **Web (1)** | The SDK-adapter + wiring every page to the new platform + full-app web QA. | Shares the React codebase with mobile (Capacitor runs the same bundle). |
| **Mobile (1)** | Native auth/push/deep-link/OTA/store integration + on-device QA of the shared bundle. | Lighter on net-new features (shared bundle), heavier on native integration + device verification. |

---

## 7. Critical path & dependencies

```
Foundation → Auth → Catalog/Search → Orders FSM + Pricing → Stripe Connect → Reconciliation → Switch-over readiness
                 \→ (Web/Mobile integrate each module as its endpoints land)
Parallel from Day 1 (non-engineering, gates switch-over not build):
   Stripe platform setup → Seller re-onboarding campaign → escrow drain plan
```
- **Longest pole:** Orders FSM + Stripe Connect + reconciliation (Sprint 2 + into 3).
- **External long-lead item:** Stripe platform + seller re-onboarding — **must start Day 1** (owned by product/ops, not the 3 devs).
- Web/Mobile are demand-paced by backend endpoint availability; Sprint 1 front-loads their independent work (adapter, auth, native cold-start) so they're never blocked.

---

## 8. Risks & mitigations (for leadership)

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | **Single backend developer** owns the critical path | 🔴 | Architecture pre-designed (docs 01–07); AI assistance sustains volume; web dev cross-trained on backend to share load; daily integration so blockers surface fast. **If this dev is unavailable, the timeline slips — flag to leadership now.** |
| R2 | **Stripe platform reality** (accounts/escrow live under legacy Sharetribe and don't transfer) | 🔴 | Treated as a parallel switch-over activity from Day 1, not in the 45–50 day build; sellers re-onboard before switch-over; in-flight money drains on the legacy system; engage Stripe support early. |
| R3 | **45–50 days is aggressive for full-parity scope** | 🔴 | Strict scope held to parity with today's product (§4); AI leverage; staged switch-over moves the risky cutover out of the window; deferred features listed explicitly; Days 43–50 buffer protects the finish. |
| R4 | **Auth regression → native lockout** | 🟠 | Front-loaded in Sprint 1; on-device cold-start tests; legacy Sharetribe stays live as fallback until switch-over confidence. |
| R5 | **Money math drift** vs the current system | 🟠 | Cent-level parity suite (Sprint 2); historical replay reconciliation (Sprint 3). |
| R6 | **Data migration gaps** | 🟠 | Idempotent keyed ETL; incremental sync; reconciliation sign-off; legacy Sharetribe kept read-only post-switch-over. |
| R7 | **Scope creep from stakeholders** | 🟡 | This document is the scope contract (parity, not parity-plus); changes trade out other items 1:1. |

---

## 9. Assumptions (the plan holds only if these are true)

1. All three engineers are **senior** and **100% dedicated** for the full 45–50 days.
2. **Opus 4.8 / Claude Code** is available and used heavily throughout.
3. The **architecture is accepted as-is** (docs 01–07); no mid-flight redesign.
4. **Sharetribe + Firebase data is accessible** (Integration API + Firestore export) and reasonably clean.
5. **Stripe platform + seller re-onboarding** is owned and started **Day 1** by product/ops (outside the 3-dev team).
6. Existing external integrations (TaxJar, Shippo, Mailgun, FCM transport, LiveKit orchestrator) **stay as-is** — except the native FCM client, which is re-integrated via the **official Firebase native SDKs** (replacing the `@capacitor-firebase/*` plugins), requiring one native rebuild.
7. The **45–50 day deliverable is "the new platform validated in staging + switch-over ready"** with full feature parity, with the production switch-over staged immediately after — not a live cutover on Day 50.
8. No major new product features beyond today's parity are introduced during the window.

---

## 10. Switch-over to the new version (immediately after Day 50, legacy Sharetribe live throughout)

1. **Pre-req (parallel, from Day 1):** seller Stripe re-onboarding ≥ target %, escrow drain plan ready.
2. Final incremental data sync + reconciliation sign-off.
3. Set legacy Sharetribe **read-only**; point frontend SDK-adapter at the new platform (web deploy + native **OTA** bundle).
4. New checkouts → new Stripe platform; legacy in-flight orders finish on the old path.
5. Intensive monitoring (auth, checkout, payout, search, errors); **one-flag rollback** to legacy Sharetribe kept warm for a defined safety window.
6. Decommission legacy Sharetribe after the safety window.

> Estimated switch-over phase: **2–4 weeks after Day 50**, paced by seller re-onboarding completion (the external dependency), not by engineering.

---

## 11. Definition of done (Day 50)

- [ ] All in-scope modules deployed and working in staging (web + native) — full feature parity with today's product.
- [ ] All historical data migrated; reconciliation report passed (counts + cent-level money parity).
- [ ] Full purchase flow works end-to-end on Stripe test mode incl. payout + refund.
- [ ] Native auth cold-start verified on real iOS + Android devices.
- [ ] Load test at 1M+ listings meets search latency SLO.
- [ ] Switch-over runbook written; rollback rehearsed in staging.
- [ ] Leadership switch-over readiness review completed.

---

## 12. One-line summary for the deck

> **In 45–50 days, a 3-person AI-assisted senior team builds Pastel's own full-fledged new platform — a properly-engineered NestJS/PostgreSQL backend with complete feature parity for everything the product does today — running the entire marketplace in staging on web and native, followed by a controlled, zero-downtime switch-over to the new version with the legacy Sharetribe system live as the safety net until we're 100% confident.**
