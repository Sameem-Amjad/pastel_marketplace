# 09 — Coverage Matrix & Readiness Sign-off

> Proof that the `docs/new-backend/` set captures **everything the current system does**, so the new backend can be built without silently dropping functionality. Produced by a multi-agent coverage audit (5 agents cross-checking the live code against docs 01–08) followed by a gap-closure pass.

**Verdict: ✅ Ready to start.** Every functional area of the current system is now represented in the docs. A small number of **business/product decisions** (§5) remain — they don't block starting, but should be resolved during Phase 0/1.

---

## 1. How this was verified

Five parallel audit agents each took a slice of the codebase, enumerated its behavior at code level, and classified every item as **COVERED / PARTIAL / MISSING** against the docs:

| Audit slice | Scope |
|---|---|
| Endpoint/route inventory | Every file in `server/api/**`, `server/*.js`, `apiRouter.js`, root mounts → mapped to an FR |
| Auth + Catalog + Search | auth flows, full listing field set, categories, search capabilities |
| Orders + Pricing + Payments + Tax + Shipping | all 5 EDN processes, FSM, pricing math, Stripe, refunds, tax, shipping |
| Firebase features + Admin | social, notifications/push, promotions, live shows, admin/compliance, the 4 Cloud Functions |
| Infra + SSR + Config + Frontend | SSR/renderer, cron, SEO/well-known, hosted config, OTA, media, SDK-adapter surface |

The audit found the **business/domain coverage was already strong**; gaps clustered in (a) web-platform/SSR/OTA/well-known plumbing, (b) a few missing data-model tables, (c) factually-wrong transaction timers, and (d) a second product store. All were closed in the gap-closure pass (§4).

---

## 2. Coverage matrix (post-closure)

All areas are now ✅ COVERED. "Doc" = where the spec lives; "Tables" = doc 02 models.

| Domain | Key responsibilities | Doc | Tables |
|---|---|---|---|
| **Identity & Auth** | email/pw, Google/Apple/Apple-native/Facebook, native deep-link bridge, scopes, dual transport, password reset, email verification (incl. tri-signal `emailVerified`/`buyerEmailVerified`/`waitlistVerified`), login-as, permissions, account gates | 03 §1, 06 | User, UserPermission, IdpLink, Credential, EmailToken, Address |
| **Catalog** | listing lifecycle + full field set (incl. enumerated JSONB long-tail), stock CAS, categories (≤3 lvl), collections, reviews, view counters, favorites, AI generation, bulk fetch + orchestrator ID validation | 03 §2, 05 | Listing, ListingImage/Media/Variant/Stats, Category, Collection, Review, Favorite |
| **Live-show product catalog** | Firestore `products` (decision: fold into Listing vs `Product`) | 03 CAT-16, 02 | Product *(decision)* |
| **Search** | enum/multi-enum has_all/has_any, range, boolean, text, category, price (+1 inclusive), keyword/relevance, geo, stock tri-state (`match-undefined`), sort, cursor pagination | 05, 03 §3 | listing_search projection |
| **Orders / FSM** | all 5 processes (instant-purchase primary; cart-stock; default-purchase; inquiry; booking deferred), corrected timers/states, cart parent/child orchestration, messaging, reviews, disputes | 04, 03 §4 | Order, OrderTransition, LineItem, StockReservation, ScheduledTransition, CartItem, Message, Review |
| **Pricing** | line-item codes (incl. day/night/hour), includeFor model, single/cart shipping (fixed vs carrier asymmetry), promos, commission, HALF_UP, enforce max-50 | 04 §2, 03 §5 | CommissionConfig |
| **Payments** | Stripe Connect onboarding, customers/cards (+ SetupIntent net-new), PI confirm/capture, escrow, payout, full/partial refunds, eligibility 409 boundary, speculative-commit, webhooks | 04 §3–4, 03 §6 | StripeAccount, StripeCustomer, PaymentMethod, PaymentIntent, Payout, Refund, StripeEvent |
| **Tax & Shipping** | TaxJar rates/nexus/reporting (+ derived refund fraction + parallel sales-tax dashboard pipeline), Shippo address/rates/labels, manual tracking (with authz fix) | 04 §6–7, 03 §7 | TaxOrder, TaxRefund, Shipment, TrackingEntry |
| **Social** | follow graph + counts, stories (24h expiry, share), highlights, likes, favorites, handles, invites | 03 §8 | Follow, Story, Highlight, HighlightStory, StoryLike, Favorite |
| **Notifications & Push** | feed, unread, mark-read, ~32-type catalog + producer map + per-mode configurable/visible subsets, preferences, FCM fan-out, emails, reminders, stale-notification cleanup, scheduled `upcoming_live` | 03 §9 + §9.1 | Notification, NotificationPreference, PushToken, OrderEmailReminder |
| **Live shows** | join/token via orchestrator, index mirror + sessions, grace sweeper, proxy, LiveKit webhook | 03 §10 | Show, ShowSession |
| **Config / CMS** | full hosted-asset set (incl. minimum-transaction-size, GSC, GA-integration, footer, top-bar, map), denormalize + version/alias contract, CMS pages, commission, native runtime config | 03 §11, 06 §4 | ConfigAsset, CmsPage, CommissionConfig |
| **Admin / Ops / Compliance** | user mgmt, refunds console, restriction appeals + history, content/DMCA reports, account deletion (erase; export net-new), waitlist+referrals, analytics, native telemetry | 03 §12 | AuditLog, UserRestriction, RestrictionAppeal, ContentReport, AccountDeletionRequest, Waitlist, AnalyticsDaily, NativeLog, DeviceBundle |
| **Media** | signed upload/download, image variants (full enumerated name list), video thumbnails | 03 §13, 06 §5.1 | MediaAsset |
| **Web / SSR tier** | retained renderer (loadable extraction, preloaded-state transit, fetchAppAssets→loadData ordering, status injection, PREVENT_DATA_LOADING_IN_SSR) | 01 §1A, 03 PLT-8 | — |
| **OTA / native-links** | bundle-manifest + `/static` CORS/CORP + publicPath patch; AASA (host-aware) + assetlinks; native-config interplay | 01 §1B, 03 PLT-9/10 | DeviceBundle, NativeLog |
| **SEO / resource routes** | robots, webmanifest, IndexNow key file, multi-sub-sitemap + private gating, basic-auth gate, CSP nonce + /csp-report | 01 §1C, 03 PLT-11 | — |
| **SSR HTML endpoints** | `/invite/:handle`, `/verify-email` bridge, mobile-link-handoff middleware | 06 §3.1, 03 PLT-12 | — |
| **Platform** | outbox, scheduler/workers, idempotency, rate-limit, observability, JSON:API compat layer | 01 §5, 03 §14 | Outbox, IdempotencyKey |

---

## 3. The four Cloud Functions — replacement mapping

| Current Cloud Function | New mechanism |
|---|---|
| `sendPushOnNotificationCreate` (Firestore onCreate → FCM) | Outbox `notification.created` → push worker → FCM |
| `expireLiveShowGrace` (every 1m) | BullMQ repeatable job over `Show.graceEndsAt` |
| `sweepOrderEmailReminders` (every 15m) | BullMQ repeatable job over `OrderEmailReminder` |
| `pollSharetribeOrderEvents` (every 5m) | **Dropped** — order events are native via the outbox (kept only as a migration sync during dual-run, doc 07 §2.3) |

---

## 4. Gap-closure log (what this audit pass added)

| # | Gap found | Closed in |
|---|---|---|
| 1 | Second product store (Firestore `products`) unmodeled | 02 `Product`, 03 CAT-16, cheat-sheet |
| 2 | `NativeLog`, `DeviceBundle` tables missing | 02 (added) |
| 3 | `ShowSession` missing (doc 01↔02 contradiction) | 02 `ShowSession` + `Show` fields |
| 4 | `Follow.status` dropped silently | 02 (added, forward-compat) |
| 5 | `UserRestriction` history vs generic AuditLog | 02 `UserRestriction` |
| 6 | Notification dedup + scheduled `upcoming_live` not modeled | 02 (dedup key + sendAt/scheduledKey) |
| 7 | Listing JSONB long-tail not enumerated (return policy, parcel/dimensions dual shape, fixed-shipping sub-fields, addresses, dup `sellerNote(s)`, AI precedence) | 02 §4.1 |
| 8 | **Instant-purchase timers factually wrong** (expire-payment target, review-period direction, missing auto-complete/escalation/partial-release timers) | 04 §1.2 (corrected verbatim from EDN) |
| 9 | Missing FSM states + EDN `escalated-disputed` typo | 04 §1.2 + §1.6 |
| 10 | Cart parent/child transaction orchestration | 04 §1.7 |
| 11 | cart-stock & default-purchase distinct timers/paths | 04 §1.8–1.9 |
| 12 | Pricing edges (day/night/hour, fixed-vs-carrier discount asymmetry, enforce max-50) | 04 §2 |
| 13 | Tax: derive refund fraction; parallel sales-tax dashboard pipeline | 04 §6 |
| 14 | Conversation merge, individual reviews, handleStock, query-filter granularity, order-tracking authz | 04 §5/§7 |
| 15 | Single-PM-today / SetupIntent net-new note | 04 §3.1 |
| 16 | Reminder timing constants | 04 §7.1 |
| 17 | **SSR ownership undefined** | 01 §1A (decision: retained) |
| 18 | **OTA/static hosting + AASA/assetlinks** (mobile-breaking if dropped) | 01 §1B |
| 19 | SEO/resource routes (robots, webmanifest, IndexNow key, sitemap, basic-auth, CSP) | 01 §1C |
| 20 | 3 missing hosted-config assets + denormalize/alias contract | 06 §4 |
| 21 | Adapter inventory omissions (stripeSetupIntents, assetCdnBaseUrl, marketplace.show, sitemapData) | 06 §4 |
| 22 | Image-variant name list | 06 §5.1 |
| 23 | SSR HTML endpoints (`/invite`, `/verify-email`, handoff) + OIDC dropped | 06 §3.1 |
| 24 | Notification ~32-type catalog + producer map | 03 §9.1 |
| 25 | Stale-notification cleanup FR | 03 NOT-7 |
| 26 | SSR/OTA/SEO platform FRs | 03 PLT-8..12 |
| 27 | ADM-5 GDPR export over-stated (erase-only today) | 03 (corrected) |
| 28 | Dead/dev files not labeled | 03 §15 |
| 29 | Search refinements (price +1, stock tri-state) | 03 SRCH-3/6 |
| 30 | Tri-signal verification + login-as audit net-new | 03 AUTH-14..16 |

---

## 5. Open decisions (resolve in Phase 0/1 — do not block start)

These need a **product/business call**, not more analysis:

1. **Firestore `products` catalog** — confirm whether live shows still use the standalone `products` collection. **Recommend:** fold into `Listing` (live shows reference listings; the `productIds` on a show are already listing UUIDs). If a genuinely separate lightweight catalog exists, keep the `Product` model.
2. **`agreedToTermsAt` on email/password signup** — today captured on IdP only. **Recommend:** capture on both.
3. **GDPR/CCPA data export** — does not exist today (only erase). Decide whether v1 builds export/portability or defers it.
4. **`Follow.status`** — keep the field for forward-compat (approval flows) or drop it (always active today). **Recommend:** keep.
5. **Booking process** — confirmed deferred (schema seam only). Re-confirm no near-term product need.
6. **Search dates/seats params** — deferred with booking; confirm.

---

## 5a. Firebase boundary (decided)

**Firebase is retained for ONE thing only: FCM push delivery.** Everything else is off Firebase:

| Firebase product | New home |
|---|---|
| Firestore (all business data) | PostgreSQL (doc 02) |
| Firebase Storage (media) | S3-compatible object storage — AWS S3 / DO Spaces (not Firebase Storage) |
| Cloud Functions (4 jobs) | BullMQ workers + cron (doc 01 §5.4–5.5) |
| Firebase Admin SDK | removed |
| `firebase` web SDK (already dead dep) | dropped |
| **FCM (Cloud Messaging)** | **KEPT — push transport only.** Trigger is ours (outbox → push worker); FCM is the last-hop OS gateway (Android + iOS via APNs). |

This is the cleanest "no Firebase" the platform can have — mobile push physically requires FCM/APNs at the OS level, so FCM stays purely as the delivery gateway with no other Firebase coupling.

**Native push integration:** FCM is wired into the mobile apps using the **official Firebase native SDKs** (Firebase iOS + Android SDK) with a custom Capacitor bridge — **not** the `@capacitor-firebase/app` / `@capacitor-firebase/messaging` community plugins (removed). The **backend is unaffected** (FCM HTTP v1 send + `PushToken` + `/push/token` are identical), but the native swap is a **🔴 IPA/APK rebuild** (`ios/`, `android/`, `Podfile`, Gradle `google-services`, `GoogleService-Info.plist`/`google-services.json`, custom bridge) — a mobile-track item in doc 08, not a backend blocker.

---

## 6. Explicitly NOT migrated (dead / dev-only)

Recorded so the audit is unambiguous — these are intentional drops, not omissions (full list in 03 §15):

`update-transaction-metadata.js` (dead, unwired) · `shows-secure.js` (dead, superseded by `live-join.js`) · `dev-login` (dev) · `test-firebase` (diagnostic) · `discount-debug` + `discountDebugLog` (temp debug) · `dummy-data` (dev) · `simpleProducts` / `productStore` (dev in-memory) · OIDC proxy well-known endpoints `/.well-known/openid-configuration` + `/jwks.json` (Sharetribe SSO, dropped) · the dead client `firebase` v11 web SDK dependency.

---

## 7. Readiness checklist

- [x] Every `server/api/**` endpoint + root route mapped to an FR or an explicit drop.
- [x] Every Sharetribe entity + extended-data field captured in the schema (typed columns + enumerated JSONB).
- [x] Every Firestore collection captured as a table (or an explicit drop).
- [x] All 5 transaction processes' states/transitions/timers reproduced (instant-purchase corrected to EDN).
- [x] Pricing/commission/tax/refund math specified to the cent.
- [x] Stripe Connect (onboarding, escrow, payout, refunds, webhooks) fully specified.
- [x] SSR ownership decided; OTA + native-links + SEO routes specified.
- [x] All 4 Cloud Functions have a replacement mechanism.
- [x] Hosted config/asset set complete; SDK-adapter surface complete.
- [x] Dead/dev code explicitly labeled "not migrated."
- [ ] §5 open business decisions resolved (Phase 0/1).

**Conclusion:** the documentation now covers the entire current system. Resolve the six §5 decisions during Phase 0/1 and the team can build with confidence that nothing is silently lost.
