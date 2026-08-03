# 01 — Architecture & System Design

> Target architecture for the new Pastel backend (NestJS + PostgreSQL + Prisma), replacing Sharetribe Flex. Read [`README.md`](./README.md) first.

---

## 1. Architecture at a glance

A **modular monolith**: one NestJS application, deployed as a horizontally-scalable stateless service, with strict internal module boundaries that could later be extracted into services. PostgreSQL is the single source of truth. Reads scale via replicas, a derived search index, and Redis caching. Background work (timers, payouts, push, search indexing) runs through a queue with idempotent workers.

```
                         ┌────────────────────────────────────────────────┐
   Web (React SSR)  ┌────▶│                  CDN / WAF                      │
   iOS / Android ───┘     │              (Cloudflare / DO)                 │
   (Capacitor)            └───────────────┬────────────────────────────────┘
                                          │ HTTPS (REST + JSON:API-compat)
                          ┌───────────────▼───────────────┐
                          │        API Gateway / LB         │
                          └───────────────┬─────────────────┘
                                          │
       ┌──────────────────────────────────▼──────────────────────────────────┐
       │                      NestJS application (stateless, N replicas)        │
       │                                                                        │
       │  HTTP layer:  Controllers · Guards (authN/Z) · Interceptors            │
       │               (JSON:API serializer, transit/Money codec) · Pipes      │
       │                                                                        │
       │  Domain modules (strict seams, in-process calls via interfaces):       │
       │  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐   │
       │  │ Identity │ Catalog  │ Orders   │ Payments │ Pricing  │ Search   │   │
       │  │ & Auth   │(listings)│ (tx FSM) │(Stripe   │ (line    │ (query)  │   │
       │  │          │          │          │ Connect) │ items)   │          │   │
       │  ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤   │
       │  │ Social   │ Notif-   │ Live     │ Media    │ Config / │ Admin /  │   │
       │  │(follow,  │ ications │ shows    │ (uploads)│ CMS      │ Ops      │   │
       │  │ stories) │          │ (proxy)  │          │          │          │   │
       │  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘   │
       │                                                                        │
       │  Platform layer:  Prisma · Outbox · Scheduler client · Cache client    │
       └───┬───────────────┬───────────────┬───────────────┬───────────────┬───┘
           │               │               │               │               │
   ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │ PostgreSQL   │ │   Redis     │ │  Workers    │ │ Object      │ │  Search     │
   │ primary +    │ │ cache +     │ │ (BullMQ):   │ │ store       │ │  index      │
   │ read replicas│ │ rate-limit  │ │ timers,     │ │ (S3/Spaces) │ │ (PG now;    │
   │ (PostGIS,    │ │ + queue     │ │ payouts,    │ │ + image     │ │ OpenSearch/ │
   │  pg_trgm)    │ │ backing     │ │ push, index │ │ resize/CDN  │ │ Typesense   │
   └──────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │ later)      │
                                                                     └─────────────┘
   External: Stripe (Connect) · TaxJar · Shippo · Mailgun · FCM · LiveKit orchestrator (api.ivector.co)
```

---

## 1A. Web / SSR tier (retained — the new backend is the JSON API only)

**Binding decision: the existing React SSR renderer tier is KEPT AS-IS.** The new NestJS backend is the JSON API; it does **not** render HTML. SSR stays a dedicated, stateless Node web tier that renders the React app and obtains its data **via the SDK adapter pointed at the new API** (doc 06 §4). This is the lowest-risk path: the SSR pipeline is intricate, load-bearing for SEO + native cold start, and decoupling it from data-source changes means the only thing that changes underneath it is the injected SDK instance.

The SSR tier today is `server/index.js` + `server/renderer.js` + `server/importer.js` + `server/dataLoader.js`. What it does, and must keep doing:

- **Catch-all render** (`server/index.js` `app.get('*')`): for every non-API, non-asset route it builds loadable chunk extractors, gets a per-request SDK (`sdkUtils.getSdk(req, res)` — **this becomes the new adapter**), runs `dataLoader.loadData(url, sdk, appInfo)`, and renders.
- **Loadable-components chunk extraction** (`server/importer.js`): two `@loadable/server` `ChunkExtractor`s — a **node** extractor reading `build/node/loadable-stats.json` and a **web** extractor reading `build/loadable-stats.json`. Both stats files are emitted by the web build; both must ship in the deploy artifact or the SSR HTML loses its script/style tags.
- **`index.html` template interpolation** (`server/renderer.js`): a two-pass Lodash template — HTML attributes via `data-htmlattr="<var>"` on the `<html>` tag (Helmet head data) and head/body tags via `<!--!<var>-->` markers. The `<` in injected markup is escaped to `<`.
- **`__PRELOADED_STATE__` serialization with the SDK transit replacer**: the Redux preloaded state is `JSON.stringify(state, types.replacer)` (the SDK's `types.replacer` from `api-util/custom-sdk`), with `<` → `<` and a double-stringify wrap so it is safe inside `<script>`. **Money / UUID / Decimal must round-trip through `types.replacer` exactly** or client hydration mismatches the server markup and React re-renders/breaks. This is the single hardest constraint on the new adapter's wire types (see doc 06 §4–5).
- **`fetchAppAssets` BEFORE per-route `loadData` ordering** (`server/dataLoader.js`): the loader dispatches `fetchAppAssets(appCdnAssets)` (translations + hosted config) **first**, then the matched routes' `loadData(params, search, config)` — and only for routes **without** `auth: true` (protected routes defer their load to the client). This ordering is a hard contract: config/translations must be present before any route data resolves.
- **Status-code injection**: the render context drives the HTTP status — `context.unauthorized` → **401**, `context.forbidden` → **403**, `context.url` → **302 redirect**, `context.notfound` → **404**, else **200**.
- **`PREVENT_DATA_LOADING_IN_SSR` escape hatch**: when this env flag is `'true'`, `dataLoader` returns empty `preloadedState`/`translations`/`hostedConfig` (skips both `fetchAppAssets` and per-route `loadData`) — a coarse DDoS/overload lever that must be preserved.

> **The only change at cutover is the injected SDK becomes the new adapter.** Everything above — chunk extraction, template interpolation, state serialization, ordering, status injection — is unchanged. Keep the SSR tier on its own deployable so a backend deploy never risks the renderer and vice-versa.

---

## 1B. OTA, native-config & app-links (preserve on the web origin) — highest-risk mobile gap

Web changes reach installed iPhones over-the-air **without an IPA rebuild** (see `docs/OTA_ARCHITECTURE.md`). The OTA + universal-link + native-handoff surface lives on the **web/SSR origin**, not the JSON API, and the cutover origin **MUST keep serving all of it byte-for-byte**. Dropping or regressing any of these silently breaks installed native apps, universal links, or native login deep links — with no app-store rejection to warn you. Treat this as a release-risk checklist.

| Endpoint / build step | Tier | Contract that MUST be preserved |
|---|---|---|
| `GET /api/bundle-manifest` | web origin | Version hash including `sha256(main.js)`; **`Cache-Control: no-store, max-age=0`** + `Pragma: no-cache` + `Expires: 0` + `Access-Control-Allow-Origin: *`. On unreadable manifest it returns **503** (`{error:'bundle-manifest-unavailable'}`), never a `200` with `version: unknown`. The OTA updater (`src/util/nativeOTA.js`) polls this on every cold start. |
| `GET /static/*` | web origin | **`Access-Control-Allow-Origin: *`** + **`Cross-Origin-Resource-Policy: cross-origin`**. A Helmet/CSP regression that drops these CORS/CORP headers breaks the Capacitor WebView's OTA bundle download outright. |
| `patch-ota-publicpath.js` / `build-ota-index.js` | build | Build steps that rewrite the bundle's public path and produce the OTA index. Must stay in the build pipeline; the manifest+download contract depends on them. |
| `GET /.well-known/apple-app-site-association` | web origin (`server/wellKnownRouter.js`) | **Host-aware AASA**: reads the `Host` header and, for hosts in `APPLE_AASA_EXCLUDED_HOSTS` (default `app.mypastel.com,live.mypastel.com`), returns empty `details: []`; otherwise full `applinks` with `appID` + `paths:['*']` (default `5396552HD7.com.anoptico.pastel`, overridable via `APPLE_APP_SITE_ASSOCIATION_APP_IDS`). `Cache-Control: public, max-age=3600`, debug header `X-AASA-Mode: excluded\|full`. |
| `GET /apple-app-site-association` | web origin | Legacy root alias of the above (registered before the basic-auth gate). |
| `GET /.well-known/assetlinks.json` | web origin (`server/wellKnownRouter.js`) | Android App Links: `delegate_permission/common.handle_all_urls` for `ANDROID_APP_LINK_PACKAGE_NAME` (default `com.anoptico.pastel`) with `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS`. Empty array if no fingerprints configured. `Cache-Control: public, max-age=3600`. |
| `GET /api/native-config` | web origin | Public, no-auth, called on every cold start. Returns `{ liveWebView, liveUrl, allowedBuilds }` (from Firestore `config/native`); `liveUrl` validated as `https://…` else nulled; `Cache-Control: public, max-age=15, s-maxage=15`. Safe fallback `{liveWebView:false, liveUrl:null, allowedBuilds:null}` on any read error. |

**The interplay that is easy to break:** the **live-WebView mode works ONLY because the live subdomain is AASA-excluded.** When the app loads its UI from the live URL (`liveWebView`/`liveUrl` from `/api/native-config`), the WKWebView navigates within that same subdomain; if that subdomain were *not* in `APPLE_AASA_EXCLUDED_HOSTS`, iOS would intercept those navigations as universal links and kick them out to Safari, breaking the in-app live experience. So the AASA exclusion list and the `liveUrl` host must stay in lockstep — change one without the other and live mode breaks on iOS.

> **Release-risk note.** None of the rows above are part of the JSON API and none have a UI that surfaces breakage. A green API deploy can still brick: OTA downloads (CORS/CORP or manifest cache regressions), universal links / native login deep-links (AASA host-awareness or assetlinks), or in-app live mode (AASA exclusion drift). Add an automated post-deploy probe for each on the web origin.

---

## 1C. Resource / SEO / platform routes (web/SSR tier unless noted)

These non-API routes also live on the **web/SSR tier** (`server/index.js` + `server/resources/*` + `server/wellKnownRouter.js`) and must be reproduced on the cutover origin. They sit **before** the basic-auth staging gate where noted.

| Route / concern | Tier | Notes |
|---|---|---|
| `GET /robots.txt` (+ private-marketplace variant) | web | `server/resources/`; private marketplaces emit a disallow-all variant. Before the basic-auth gate. |
| `GET /site.webmanifest` | web | `server/resources/webmanifest.js`; pulls the marketplace **name** via `sdk.marketplace.show` (adapter must answer this — doc 06 §4). Before the gate. |
| `GET /<INDEXNOW_KEY>.txt` | web | IndexNow **domain-verification key file** (`server/resources/indexnowKey.js`), `text/plain`, `Cache-Control: public, max-age=86400`. Registered **before** the basic-auth gate and **distinct** from the IndexNow *ping*. |
| `GET /sitemap-:resource(.xml)` | web | Multi-sub-sitemap generator (`server/resources/sitemap.js`): `sitemap-index` → `sitemap-default` (built-in public pages) + `sitemap-recent-listings` (≤10k) + `sitemap-recent-pages` (CMS `/p/:pageId`). 1-day memory cache, `Cache-Control: public, max-age=86400`, `SITEMAP_DISABLED` kill-switch. **Private-marketplace gating** via the access-control asset. Uses server-only `sdk.sitemapData.queryListings` / `queryAssets` (doc 06 §4). |
| Basic-auth staging gate | web | Applied (non-dev) after the routes above. **Bypassed by:** `/static/*`, `/.well-known/*` (+ `/apple-app-site-association` alias), `/products/bulk` (orchestrator validation), the IndexNow key file, `/robots.txt`, `/sitemap-*`, `/site.webmanifest`, `/favicon.ico`, the invite/verify-email/handoff routes. |
| CSP nonce pipeline + `POST /csp-report` | web | Helmet has `contentSecurityPolicy:false`; CSP is applied by a custom chain with a per-request 32-byte hex nonce in `res.locals.cspNonce` (consumed by `renderer.js`). Mode from the `CSP` env var (`block`/`report`). `/csp-report` accepts only `application/csp-report` + `application/reports+json`, logs to Sentry, returns **204**. |
| PHP / bot-scan 404 filter | web | An early regex (`.php`/`.php7`/`/wp-*`/`cgi-bin`/`*.rar`/`*.zip`/`*.7z`…) returns the 404 page without entering the React render path. |
| `GET /favicon.ico` | web | Always **404** (`favicon.ico not found.`) — registered before the gate; the real icon ships as a static asset. |

---

## 2. Why these choices

### 2.1 Modular monolith (not microservices, yet)

The current system is one Sharetribe tenant + one Express app. The domains are **highly coupled around the transaction** (orders touch pricing, payments, tax, stock, notifications, and listings simultaneously). Splitting these into services on day one would turn in-process calls into distributed transactions — a large tax on a team that is also re-implementing Sharetribe's semantics for the first time.

A modular monolith gives us:
- **One deploy, one DB, in-process calls** → no distributed-transaction problem for checkout/refunds.
- **Strict module boundaries** (each module exposes a service interface; cross-module access only through interfaces, never another module's Prisma models) → we can extract a service later by replacing the in-process call with an RPC.
- **Clear extraction candidates already visible:** Search (read-heavy, independently scalable), Media/image processing (CPU-bound), Notifications/push (spiky, async). These are the first to peel off if needed.

### 2.2 PostgreSQL + Prisma

- Orders and money demand **ACID transactions and constraints** (unique payout per order, single-use promo codes, stock CAS). Relational is the right model; Sharetribe's "extended data" JSON maps to typed columns + JSONB for the long tail.
- **Prisma** for schema, migrations, type-safe writes and most reads. The few hot read paths (search, feeds) use **raw parameterized SQL / views** through Prisma's `$queryRaw`, hitting **read replicas**.
- PostGIS for geo; `pg_trgm` + `tsvector`/GIN for text; B-tree + partial indexes for filters (doc 05).

### 2.3 Stateless app + Redis + workers

- App holds **no session state** (matches today's stateless Express). Auth is token-based (doc 06). This lets us scale replicas horizontally behind a load balancer.
- **Redis** for caching (hot config, listing cards, top-sellers), rate limiting, and as the **BullMQ** queue backend.
- **Workers** (same codebase, `WORKER=true` process) consume queues for: scheduled state transitions (the EDN timers), Stripe payouts/refunds retries, push fan-out, search index sync, email reminders, story expiry. Idempotent and at-least-once.

---

## 3. Technology stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20 LTS | Matches current engines range. |
| Framework | NestJS 10+ | Modules, DI, guards, interceptors, `@nestjs/schedule`, `@nestjs/bullmq`. |
| Language | TypeScript 5 (strict) | |
| ORM | Prisma 5+ | `prisma migrate`; `$queryRaw` for hot paths; read-replica datasource. |
| DB | PostgreSQL 16 + PostGIS + pg_trgm + (optional) ltree | Managed (DO Managed PG / RDS). Primary + ≥1 read replica. |
| Cache / queue | Redis 7 (managed) + BullMQ | Cache, rate-limit, job queue. |
| Search (phase A) | Postgres FTS + trigram + PostGIS | Doc 05. |
| Search (phase B) | OpenSearch or Typesense | Added via outbox/CDC when needed. |
| Object storage | S3-compatible (AWS S3 / DO Spaces) | Listing images, story/highlight video, appeal attachments. |
| Image processing | `sharp` worker or Imgix/Cloudflare Images | On-the-fly variants behind CDN; reproduces `imageVariant.<name>`. |
| Payments | **Stripe** (Connect) — `stripe` Node SDK | Direct integration; webhooks. Doc 04. |
| Tax | TaxJar (existing) | Re-home the existing `taxjar.js` logic. |
| Shipping | Shippo (existing) | Re-home `shippo.js`. |
| Email | Mailgun (existing) | Re-home senders + templates. |
| Push | Firebase Cloud Messaging (existing transport) | We own the trigger/token store; FCM stays the delivery channel. |
| Live video | LiveKit via orchestrator `api.ivector.co` (existing) | Backend stays a thin proxy + index. |
| AI | Google Gemini (existing) | Listing generation endpoint. |
| Auth | NestJS Passport + JWT (access) + rotating refresh tokens; Argon2id passwords | Doc 06. |
| Observability | OpenTelemetry traces, Prometheus metrics, structured logs, Sentry | |
| Config / secrets | Env + secrets manager; DB-backed runtime config | Replaces Sharetribe hosted assets. |
| API docs | OpenAPI (Nest Swagger) | |
| Tests | Jest (unit) + Testcontainers (integration on real PG) + contract tests | |
| CI/CD | Existing CI provider → containerized deploy (DO App Platform / k8s) | Blue/green. |

---

## 4. Module map (bounded contexts)

Each module owns its tables and exposes a service interface. **No module reads another module's tables directly.**

| Module | Owns | Key responsibilities | Source heritage |
|---|---|---|---|
| **Identity & Auth** | users, credentials, sessions/refresh tokens, idp_links, permissions, email-verification, password-reset | Signup/login, OAuth (Google/Apple/Facebook), token issue/refresh, scopes (`public-read`/`user`/`trusted`), `loginAs`, ban/restrict | Sharetribe auth + `server/api/auth/*`, `auth.duck.js`, `user.duck.js` |
| **Catalog** | listings, listing_images, listing_media, categories, collections, variants, listing_stats | Listing CRUD + lifecycle (draft→pendingApproval→published→closed), stock, categories, collections, reviews denormalization | Sharetribe listings/ownListings + `EditListingPage`, `categories.js`, `listings.js` |
| **Search** | search projections / views (read-only over catalog) | Faceted query, full-text, geo, sort, cursor pagination, suggestions | Sharetribe listing query + `SearchPage.duck.js`, `search.js` |
| **Orders** | transactions, transitions, line_items, stock_reservations, messages, reviews | The transaction **state machine engine**, cart, messaging, reviews lifecycle, time-based transitions | Sharetribe tx processes + `CheckoutPage`, `TransactionPage`, `InboxPage` |
| **Pricing** | (stateless) commission_config, tax snapshots | Server-authoritative line-item/commission/tax/promo computation; speculative pricing | `lineItems.js`, `cartLineItems.js`, `taxLineItems.js` |
| **Payments** | stripe_accounts, stripe_customers, payment_methods, payment_intents, payouts, refunds, stripe_events | Direct Stripe Connect: onboarding, customers/cards, PaymentIntents, capture, payouts (escrow), refunds, webhooks | Sharetribe Stripe brokering + `stripeConnectAccount.duck.js`, `paymentMethods.duck.js`, `admin-refunds.js` |
| **Tax** | tax_orders, tax_refunds (TaxJar mirror) | Rate resolution, nexus, TaxJar order/refund reporting | `taxjar*.js`, `tax.js` |
| **Shipping** | shipments, tracking | Shippo address/rates/labels, manual tracking | `shippo.js`, `order-tracking.js` |
| **Social** | follows, stories, highlights, story_likes, favorites | Social graph, stories (24h expiry), highlights, likes, wishlist | Firestore `follows`/`stories`/`highlights` + `follow.js`, `user-stories.js` |
| **Notifications** | notifications, notification_preferences, push_tokens, order_email_reminders | In-app feed, unread counts, preferences, push fan-out (→FCM), email reminders | Firestore + `notifications.js`, `register-push-token.js`, Cloud Functions |
| **Live shows** | shows (index), show_sessions | Thin proxy to orchestrator + Postgres index + grace-window sweeper | `orchestrator-proxy.js`, `shows-*.js`, `live-join.js` |
| **Media** | media_assets, signed-url issuance | Upload (signed URLs), image-variant URLs, video handling | `files.js`, `sdkLoader.js` image variants |
| **Promotions** | discounts, discount_usages, shop_promotions, shop_promotion_usages | Global + per-seller promo codes, single-use guards, usage stats | Firestore + `validate-discount.js`, `shop-promotions.js` |
| **Config / CMS** | config_assets, listing_types, listing_fields, user_types, cms_pages, branding, translations | DB-backed runtime config replacing Sharetribe hosted assets | `hostedAssets.duck.js`, `configHelpers.js`, hosted JSON assets |
| **Admin / Ops** | audit_log, restriction_appeals, content_reports, account_deletion_requests, waitlist, native_logs, device_bundles, analytics | Operator tooling, moderation, compliance, telemetry, analytics counters | `admin-*.js`, `report-content.js`, `analytics-events.js`, etc. |
| **Platform (shared)** | outbox, idempotency_keys, jobs | Outbox relay, idempotency, scheduling, cross-cutting infra | new |

> The dependency rule: **Orders** orchestrates **Pricing**, **Payments**, **Tax**, **Shipping**, **Catalog (stock)**, and emits events consumed by **Notifications**, **Search**, **Tax**. Orchestration lives in Orders; the others are leaf services.

---

## 5. Cross-cutting concerns

### 5.1 Request pipeline (NestJS)
```
Request
  → Helmet/CORS (native origins: capacitor://localhost, https://localhost, ionic://localhost, app hosts)
  → Body parsing (JSON; legacy application/transit+json codec for compat window — see doc 06)
  → AuthGuard (resolves token from cookie OR X-Native-Token header → principal + scope)
  → PermissionsGuard (effectivePermissionSet semantics)
  → RateLimitGuard (Redis)
  → Controller → Module service
  → SerializerInterceptor (JSON:API {data, included, meta}; Money & UUID encoding) — see doc 06
  → ErrorInterceptor (Sharetribe-compatible error envelopes during compat window)
```

### 5.2 Money & precision
A `Money` value object: `{ amountMinor: bigint, currency: string }`. All arithmetic via a decimal library, rounded **HALF_UP to whole minor units** (matches `lineItemHelpers.js`). Persisted as `BIGINT` cents + `CHAR(3)` currency. Never floats. Detailed in doc 04.

### 5.3 Idempotency
- **Inbound:** mutating endpoints (checkout, refund) accept an `Idempotency-Key`; stored in `idempotency_keys` with the response, replayed on retry.
- **Outbound:** every Stripe/TaxJar call passes a deterministic idempotency key derived from `(orderId, transition, attempt-bucket)`.

### 5.4 Transactional outbox
Domain events (`order.transitioned`, `listing.published`, `notification.created`, `payout.released`) are written to an `outbox` table **inside the same DB transaction** as the state change. A relay worker publishes them to: search indexer, push/email, TaxJar sync, webhooks, analytics. This guarantees no lost side-effects and replaces Firestore's `onCreate` trigger model.

### 5.5 Scheduling (replaces Sharetribe time-based transitions + Firebase Cloud Functions)
Sharetribe ran the EDN timers (`expire-payment` PT15M, `auto-cancel` P3D, `auto-mark-received` P14D, review P7D, etc.) natively. We replace them with:
- A **due-transitions table** (`scheduled_transitions(order_id, transition, run_at, status)`) written when an order enters a state with a timer.
- A worker polling `run_at <= now()` (every ~30s) that attempts the transition idempotently (CAS on current state).
- The 4 Firebase scheduled functions (live-show grace expiry every 1m, sharetribe-events poll — dropped, order-email-reminders sweep 15m) become BullMQ repeatable jobs. Detail in docs 04 & 03.

### 5.6 AuthZ scopes (preserve Sharetribe semantics)
Three principal scopes carried in the access token, mirrored from today: **`public-read`** (anonymous/guest), **`user`** (logged-in), **`trusted`** (server-to-server privileged, never issued to browsers — replaces `exchangeToken`). Admin/ops endpoints additionally require an operator credential (replaces `x-admin-secret`). Detail in doc 06.

### 5.7 Observability & SLOs
- Traces across HTTP → service → Prisma → Stripe with OpenTelemetry.
- RED metrics per endpoint; queue depth/lag; payout/refund success rates; search latency p50/p95/p99.
- Initial SLOs: search p95 < 300 ms, listing detail p95 < 200 ms, checkout initiate p95 < 800 ms, 99.9% API availability.

---

## 6. Key sequence diagrams

### 6.1 Checkout (single item) — replaces the Sharetribe privileged-transaction dance

```
Client            API (Orders)        Pricing        Payments(Stripe)     Catalog
  │ POST /checkout/speculate            │                  │                │
  │───────────────▶│  compute lineItems │                  │                │
  │                │──────────────────▶ │ (commission,     │                │
  │                │ ◀──────────────────│  tax, promo)     │                │
  │ ◀──────────────│ speculative totals │                  │                │
  │                │                    │                  │                │
  │ POST /checkout (idempotency-key)    │                  │                │
  │───────────────▶│ reserve stock (CAS)│──────────────────────────────────▶│
  │                │ recompute lineItems │                  │                │
  │                │ create order (pending-payment)         │                │
  │                │ create PaymentIntent (manual or auto capture)           │
  │                │───────────────────────────────────────▶│               │
  │ ◀──────────────│ clientSecret                            │               │
  │ stripe.confirmPayment(clientSecret)  ── 3DS/SCA in browser ──▶ Stripe     │
  │ POST /checkout/confirm               │                  │                │
  │───────────────▶│ verify PI succeeded │─────────────────▶│               │
  │                │ transition → purchased; capture funds (held = escrow)   │
  │                │ outbox: order.transitioned ─▶ notify seller, TaxJar, search
  │ ◀──────────────│ order                                   │               │
```
Funds are **captured to the platform balance (escrow)**. Payout (Stripe transfer to the seller's Connect account) fires only at `mark-received` / `auto-mark-received` (P14D). Full detail + the cart variant in doc 04.

### 6.2 Search request

```
Client → GET /listings?keywords=..&pub_categoryLevel1=..&price=..&sort=..&cursor=..
  → Search module builds a parameterized SQL query against the `listing_search` projection
    (FTS rank + trigram + filters + PostGIS if geo) on a READ REPLICA
  → cursor (keyset) pagination, perPage default 24
  → SerializerInterceptor → JSON:API {data:[listingCards], included:[author,image], meta:{cursor,total?}}
  → CDN/Redis caches hot, anonymous queries (short TTL)
```

### 6.3 Async side-effects via outbox

```
DB tx:  UPDATE order ...           ┐
        INSERT scheduled_transition │  (single transaction)
        INSERT outbox(event)        ┘
                │
   relay worker polls outbox →  ├─▶ Search indexer (update listing_search / push to engine)
                                ├─▶ Notifications (create notification row → push worker → FCM)
                                ├─▶ TaxJar sync (create/refund order)
                                └─▶ Webhooks / analytics
```

---

## 7. Deployment topology

| Environment | Purpose | Data |
|---|---|---|
| **dev** | matches `dev.mypastel.com` model | isolated PG + Redis + test Stripe + sandbox TaxJar |
| **staging** | pre-prod, migration dry-runs | prod-like, anonymized data |
| **prod** | live | PG primary + replica(s), Redis HA, multi-AZ |

- **App:** ≥2 stateless API replicas + ≥1 worker replica, autoscaled on CPU/queue depth. Blue/green or rolling deploys; health/readiness probes (`/healthz`, `/readyz`).
- **DB:** managed Postgres, automated backups + PITR, read replica(s) for search/feeds. Connection pooling via PgBouncer (transaction mode) — Prisma + serverless-ish replicas need bounded connections.
- **Secrets:** managed secret store; no secrets in repo (the current repo even has a stray service-account JSON — we will use env/secret-store only).
- **CDN:** fronts media + cacheable GETs; WAF + rate limiting at the edge.
- **Webhooks:** Stripe/Shippo/LiveKit webhook endpoints are HMAC-verified, replay-protected (store `stripe_events` by event id), and idempotent.

---

## 8. What stays external (and the contract with it)

| External | Contract | Owner of state |
|---|---|---|
| **Stripe Connect** | We create accounts/customers/PIs/transfers/refunds; we consume webhooks. | Stripe (we mirror key fields in Postgres). |
| **TaxJar** | We compute rates + report orders/refunds (ids `pastel-{orderId}`). | TaxJar (we keep snapshots). |
| **Shippo** | Address validate/parse, rates, labels. | Shippo (we store shipment + tracking). |
| **Mailgun** | Transactional email send. | Stateless. |
| **FCM (Firebase Cloud Messaging)** | Push delivery only; we hold device tokens + preferences and call FCM to send. | We own tokens; FCM delivers. |
| **LiveKit orchestrator** (`api.ivector.co`) | Source of truth for live rooms; we proxy + keep a Postgres index + grace window. | Orchestrator (we index). |
| **Object storage + image CDN** (S3-compatible: AWS S3 / DO Spaces — **not** Firebase Storage) | We issue signed upload URLs; serve variant URLs. | Storage (we keep `media_assets` rows). |
| **Google Gemini** | AI listing generation from images. | Stateless. |

> **Firebase footprint = FCM only.** Per decision, the new platform does **not** use Firebase for anything except **Cloud Messaging (push transport)**. Firestore → PostgreSQL, Firebase Storage → S3-compatible object storage, Firebase Cloud Functions → BullMQ workers/cron, Firebase Admin SDK → removed. FCM is retained purely as the Android/iOS push gateway because mobile push delivery requires it at the OS level (Apple APNs is reached via FCM here too). The push *trigger* is ours (outbox → push worker, doc 01 §5.4); FCM is only the last-hop delivery. The dead client `firebase` web SDK dependency is dropped.
>
> **Native push integration:** the mobile apps integrate FCM via the **official Firebase native SDKs** (Firebase iOS SDK + Firebase Android SDK) with a small **custom Capacitor bridge** — **not** the `@capacitor-firebase/app` / `@capacitor-firebase/messaging` community plugins (those are removed). **Backend impact: none** — the backend still stores `PushToken`s and sends via the FCM **HTTP v1 API**; the `/push/token` registration contract and the outbox→push-worker trigger are identical regardless of the native SDK. **Native impact: 🔴 IPA/APK rebuild** — this touches `ios/`, `android/`, `Podfile`, Gradle (`google-services`), `GoogleService-Info.plist` / `google-services.json`, and the custom bridge (see doc 08 mobile track).

---

## 9. Non-functional requirements

| NFR | Target |
|---|---|
| Scale | 1M+ active listings, 10M+ historical; 100s of writes/s peak, 1000s of reads/s. |
| Availability | 99.9% API; graceful degradation of search/social if a dependency is down. |
| Latency | search p95 < 300 ms; detail p95 < 200 ms; checkout initiate p95 < 800 ms. |
| Durability | No lost orders/payments; outbox guarantees side-effects; PITR backups. |
| Security | OWASP ASVS L2; PCI handled by Stripe (no raw PAN on our servers); least-privilege; audit log. |
| Compliance | GDPR/CCPA deletion + export; DMCA; sales-tax reporting. |
| Cost | Single DB + Redis + app/worker fleet; defer search engine until justified. |

See doc 05 for the capacity/scaling model and doc 07 for the rollout that gets us there safely.
