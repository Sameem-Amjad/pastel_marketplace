# 06 — Auth/Identity & API Contract

> The identity/auth service that replaces Sharetribe auth, plus the API contract and the strategy for connecting the existing React frontend to the new backend with minimal churn. Auth is the **highest-risk** subsystem — see `.claude/rules/auth-sensitive.md`.

---

## 1. Auth: what we must preserve

Sharetribe's auth is deceptively load-bearing. The new identity service must reproduce these exact semantics or the app cold-starts into a locked-out state:

| Behavior | Must keep |
|---|---|
| **Scopes** | `public-read` (anon/guest) · `user` (logged in) · `trusted` (server-only privileged, replaces `exchangeToken`) — never leak trusted to the browser. |
| **Dual transport** | Web = cookie; **Capacitor native = `X-Native-Token` header** (WKWebView can't share the cookie jar). Server prefers the **user-scoped** token; a stale anonymous cookie must not shadow a valid native token (a recurring historical bug). |
| **Boot ordering** | `authInfo` MUST resolve before `fetchCurrentUser` dispatches (`src/index.js`). Replicate an `/auth/info` endpoint with this contract. |
| **permissionsLoaded gate** | `currentUser` hydration includes a permission set whose presence gates permission-based redirects (avoids false "no access" during partial hydration). |
| **IdP auto-create** | First social login auto-creates the account, sets `agreedToTermsAt`, then logs in; native deep-link hand-off returns the token via `pastel://`. |
| **Account gates** | `restricted` → 403 on initiate-tx; `banned`/`deleted` → login blocked. |

---

## 2. Token design

- **Access token:** short-lived JWT (~15 min), signed (RS256/ES256), claims `{ sub, scope, userType, ver }`. `scope ∈ {public-read, user, trusted}`. Stateless verification in the `AuthGuard`.
- **Refresh token:** opaque, rotating, hashed in `Credential`; ~30–90 day sliding expiry; rotation on every use; rev{ocation on logout/ban. Reuse-detection → revoke family.
- **Trusted scope:** issued only to the backend itself (service credential) for privileged internal operations (pricing/transitions/admin) — replaces Sharetribe's `sdk.exchangeToken()`. Never minted for a browser.
- **Passwords:** Argon2id.
- **CSRF:** for cookie transport, use SameSite=Lax + CSRF token on mutations; native uses the header transport (not cookie) so it's not CSRF-exposed.

### Transport resolution (the AuthGuard)
```
token =  header 'X-Native-Token'   (native)   ── prefer if scope=user
      || cookie 'pa_at'            (web)
principal = verify(token) → { userId, scope, userType } | { scope: 'public-read' }
```

---

## 3. Identity endpoints (replace Sharetribe SDK auth + `server/api/auth/*`)

| Endpoint | Replaces |
|---|---|
| `POST /auth/signup` | `sdk.currentUser.create` |
| `POST /auth/login` | `sdk.login` |
| `POST /auth/logout` | `sdk.logout` |
| `POST /auth/refresh` | SDK token refresh |
| `GET  /auth/info` | `sdk.authInfo` (the boot gate) |
| `GET  /auth/{google,apple,facebook}` + `/callback` | `auth/{google,apple,facebook}.js` |
| `POST /auth/apple-native` | `auth/apple-native.js` |
| `GET  /auth/native-callback` | `nativeCallbackBridge.js` |
| `POST /auth/password/forgot` · `POST /auth/password/reset` | `passwordReset.*` |
| `POST /auth/email/verify` · `POST /auth/email/send-verification` | buyer verification bridge |
| `GET  /me` (== currentUser.show) | `sdk.currentUser.show` |
| `PATCH /me` · `/me/email` · `/me/password` · `/me/addresses` | profile/contact updates |
| `POST /admin/login-as` | `initiate-login-as.js` / `login-as.js` |

OAuth uses NestJS Passport strategies (`passport-google-oauth20`, `passport-facebook`, custom Apple ES256 + Apple-native JWK verify) — mirroring the existing implementations, including the **20s per-hop timeout** to dodge Cloudflare 504 and the native deep-link bridge.

### 3.1 SSR HTML bridge / handoff endpoints (live on the web/SSR tier, not the JSON API)

Beyond the OAuth token hand-off, the **web/SSR tier** serves a few HTML endpoints that bridge external browsers and social in-app webviews into the native app. These are not JSON API routes; they render HTML and emit `pastel://` deep links. The new backend does not own them, but the cutover **web origin** must reproduce them or native deep-linking and email verification regress.

| Route | Tier | What it does |
|---|---|---|
| `GET /invite/:handle` | web/SSR | Public invite landing page. Renders OG/Twitter meta (image priority cover → avatar → app logo), iMessage smart banner + Apple touch icons; records a **tools hit** (`recordInviteHit(handle, …, 'click')`). If social in-app browser → serve the handoff bridge; if Capacitor WebView (non-social) → **302 → `/shop/<handle>?from=invite`** (records `'shop_open'`); else SSR the landing page with a Capacitor-bridge failsafe bounce. `no-store`. |
| `GET /verify-email` | web/SSR | **SSR bridge page into the native app**, distinct from the **`/api/verify-email` API** (the JSON verification call lives under §3 `POST /auth/email/verify`). When opened in a mobile external browser with a token `t`, it renders an HTML page that attempts `pastel://verify-email?t=<token>` with a ~1.5s app-detection fallback to the App/Play store; `_format=json` falls through to the API handler. Removes the CSP header; `no-store`. |
| `mobile-link-handoff` middleware | web/SSR | General social-in-app-browser → native-app handoff for **shop / product / live / invite** links (broader than the OAuth-token handoff). Detects social in-app browsers (Instagram, etc.), builds `pastel://<path>` (invite forced to `pastel://shop/<handle>?from=invite`) + an Android app-intent, with `web=1`/`_format=json` opt-outs. Removes the CSP header; `no-store`. |

> **OIDC well-known endpoints are DROPPED.** `/.well-known/openid-configuration`, `/.well-known/jwks.json`, and `api-util/idToken.js` existed only to act as an OIDC identity-provider proxy for **Sharetribe SSO**. The new backend issues its own tokens (§2) and is not an OIDC IdP for a third party, so these endpoints are **not** reproduced. (The other `.well-known` routes — AASA + assetlinks — are **kept**; see doc 01 §1B.)

---

## 4. Frontend integration strategy (minimize churn)

This is the linchpin of a smooth cutover. The current frontend is built **entirely** on Sharetribe's JSON:API shape:
- One SDK instance injected via Redux `thunk.withExtraArgument(sdk)` — every thunk calls `sdk.<resource>.<method>()`.
- Responses normalized by `src/util/data.js` + `marketplaceData.duck.js` assuming `{ data, included, meta }`, `id = {uuid}`, `price = Money{amount,currency}`, transit `BigDecimal`→`Decimal`.

> **Note:** per your direction we are **not changing the current repo now**. This section defines the *contract the new backend exposes* so that, at cutover, the frontend can switch with a single seam — not a rewrite.

### Recommended: a Sharetribe-compatible API + drop-in SDK adapter
The new backend exposes endpoints that return **Sharetribe-shaped JSON:API documents**, and the frontend swaps the Flex SDK for a thin **adapter object with the identical `sdk.<resource>.<method>` surface** pointed at the new API. Then:
- `data.js`, `marketplaceData.duck.js`, every `ensure*`/selector, and all ~hundreds of consumers keep working **untouched**.
- The change is localized to one place (the SDK instance creation + token store).

The adapter must implement the resources actually used (full inventory in the audit): `listings`, `ownListings`, `transactions`/`transaction`, `processTransitions`, `messages`, `currentUser`, `users`, `reviews`, `images`, `stock`, `timeslots`/`availabilityExceptions` (dormant), `stripeAccount`/`stripeAccountLinks`/`stripeCustomer`, `stripeSetupIntents` (`sdk.stripeSetupIntents.create` — card setup on the Payment Methods page), `passwordReset`, `assets*`, `authInfo`/`login`/`logout`.

Plus a few non-obvious surfaces the audit flagged as also required:
- **`assetCdnBaseUrl`** — the asset CDN base used by the SDK config (env `REACT_APP_SHARETRIBE_SDK_ASSET_CDN_BASE_URL`); the adapter/config must expose the equivalent so asset URLs resolve against the new origin.
- **`marketplace.show`** — used **server-side** by `server/resources/webmanifest.js` to read the marketplace **name** (`fields.marketplace: ['name']`) for `/site.webmanifest`.
- **`sdk.sitemapData.queryListings` / `sdk.sitemapData.queryAssets`** — **server-only** resources used by the sitemap routes (`server/resources/sitemap.js`) to page recent listings and CMS asset pages. These have no client/Redux consumer but the SSR/web tier needs them, so the adapter must implement them too.

> **Wire-type round-trip constraint.** The SSR `__PRELOADED_STATE__` path serializes the entire Redux store with the SDK's `types.replacer` (doc 01 §1A). Every value the adapter returns that lands in Redux — `Money`, `UUID`, `Decimal` (transit `BigDecimal`) — **must round-trip through `types.replacer` exactly**, or server-rendered markup and client hydration diverge. The adapter is not free to invent its own scalar encodings for these; it must emit the same transit-compatible shapes.

### Compatibility shapes the backend must emit (during the window)
- `{ data, included, meta }` envelope; `id` encoded as `{ uuid: "..." }`; relationships as `{ data: {id,type} | [...] }`.
- `Money` as `{ amount: <minor units int>, currency }`.
- Optional `application/transit+json` codec (BigDecimal→Decimal) for parity — or negotiate plain JSON if the adapter normalizes.
- Sharetribe-compatible **error envelopes** so existing `src/util/errors.js` mappers (e.g. stock old-total mismatch, listing not found) keep working.

### Stays direct to Stripe (no change)
`stripe.duck.js` (`stripe.confirmPayment`, `handleCardSetup`) talks to Stripe.js directly — unaffected. Only `stripeAccount`/`stripeCustomer` *management* calls move to the new API.

### Config/assets re-point
`hostedAssets.duck.js` `sdk.assets*` calls → new `/config/*` + `/cms/*` endpoints returning the same merged-config shape `configHelpers.mergeConfig` expects (doc 03 §11).

**Complete hosted-asset enumeration the backend must serve.** The adapter calls `sdk.assetsByVersion`/`sdk.assetsByAlias` (multi) and `sdk.assetByVersion`/`sdk.assetByAlias` (single); the new `/config/*` endpoints replace all of them. The full set of asset paths (`configDefault.js` `appCdnAssets`) is:

| Asset path | Config key | Notes |
|---|---|---|
| `/content/translations.json` | `translations` | i18n bundle. |
| `/content/footer.json` | `footer` | Footer CMS block. |
| `/content/top-bar.json` | `topbar` | Top-bar CMS block. |
| `/design/branding.json` | `branding` | **Image refs resolved from `included`** via `denormalizeAssetData` (see below). |
| `/design/layout.json` | `layout` | Layout config (incl. listing-image aspect ratio used by image variants, §6). |
| `/users/user-types.json`, `/users/user-fields.json` | `userTypes`, `userFields` | |
| `/listings/listing-categories.json`, `/listings/listing-types.json`, `/listings/listing-fields.json`, `/listings/listing-search.json` | `categories`, `listingTypes`, `listingFields`, `search` | |
| `/transactions/minimum-transaction-size.json` | `transactionSize` | **(was missing)** minimum-transaction-size gate. |
| `/integrations/analytics.json` | `analytics` | **(was missing)** Google Analytics integration config / `googleAnalytics.measurementId` — read by `getGoogleAnalyticsId(configAssets, path)`. **Distinct** from the internal `AnalyticsDaily` counters (Admin/Ops module). |
| `/integrations/google-search-console.json` | `googleSearchConsole` | **(was missing)** GSC site-verification config. |
| `/integrations/map.json` | `maps` | Map provider config. |
| `/general/localization.json`, `/general/access-control.json` | `localization`, `accessControl` | `accessControl` gates the private-marketplace behavior (also used by the sitemap/robots routes). |

Two contracts the backend must honor exactly because `hostedAssets.duck.js` depends on them:
- **`denormalizeAssetData({ data, included })`** — branding (and any asset that references images) ships image entities in the JSON:API `included` array; the duck resolves those refs out of `included`. The `/config/*` responses must keep the `{ data, included }` envelope with image refs denormalizable the same way.
- **Asset `version` + `'latest'` alias contract** — the duck fetches either by an explicit `version` string or by the `'latest'` **alias**, and in both cases reads the resolved version back from `response.data.meta.version`. The backend must support both addressing modes and return `meta.version` so the frontend's cache-busting/versioning keeps working.

### Post-cutover modernization (optional, later)
Once off Sharetribe, introduce idiomatic REST/DTOs by refactoring `data.js` + selectors **behind their existing function signatures** (they're already a clean abstraction boundary — components call `getListingsById`/`ensureListing`, not raw responses). Large but mechanical; not a cutover blocker.

---

## 5. External API surface (new, idiomatic — for native/new clients)

Alongside the compat layer, the backend exposes clean REST (documented via OpenAPI). Representative routes (full set traces to doc 03):

```
# Catalog
GET    /listings                 (search; doc 05 params)         GET /listings/:id
POST   /listings                 PATCH /listings/:id             POST /listings/:id/publish|close|reopen
POST   /listings/:id/images      PATCH /listings/:id/stock (CAS)
GET    /categories               GET /shops/:handle/listings

# Orders / checkout
POST   /checkout/speculate       POST /checkout                  POST /checkout/confirm
GET    /orders                   GET /orders/:id                 POST /orders/:id/transitions/:name
POST   /orders/:id/messages      GET /orders/:id/messages
GET    /cart  POST /cart/items  PATCH /cart/items/:id  DELETE /cart/items/:id

# Payments
POST   /payments/connect/account POST /payments/connect/link     GET /payments/connect/status
POST   /payments/customer/setup-intent  GET/POST/DELETE /payments/methods
POST   /webhooks/stripe          (HMAC)

# Social / notifications
POST/DELETE /follow/:userId      GET /users/:id/followers|following
POST   /stories  GET /users/:id/stories  POST /stories/:id/like
GET    /notifications  GET /notifications/unread-count  POST /notifications/mark-read
POST   /push/token  DELETE /push/token

# Config / admin / ops
GET    /config/*  GET /cms/:slug
/admin/users/*  /admin/orders/* (refunds)  /admin/taxjar/*  (operator-scoped)
/internal/* (scheduler/sweeper, service-scoped)   GET /healthz /readyz
```

Conventions: cursor pagination, `Idempotency-Key` on mutations, RFC-7807 problem+json errors on the new surface (compat envelope only on the legacy adapter routes), per-scope rate limits.

### 5.1 Image variants the media service / CDN must answer to

The frontend requests images by **named variant** (`imageVariant.<name>`, built by `createImageVariantConfig` in `src/util/sdkLoader.js`). The new image service/CDN must reproduce every variant name the running app references — an unknown variant name returns no usable URL and breaks the image. All variants are `{ w, h, fit: 'crop' }` with a **hard 3072px cap on either dimension**. The required runtime variant names:

| Variant | Width | Height | Used by |
|---|---|---|---|
| `listing-card` | 400 | `round(aspect·400)` | listing cards |
| `listing-card-2x` | 800 | `round(aspect·800)` | listing cards (2x DPR) |
| `listing-card-4x` | 1600 | `round(aspect·1600)` | listing cards (4x) |
| `listing-card-6x` | 2400 | `round(aspect·2400)` | listing cards (6x) |
| `square-xsmall` | 40 | 40 | avatars |
| `square-xsmall2x` | 80 | 80 | avatars (2x) |
| `scaled-small` | small | aspect-scaled | scaled media |
| `scaled-medium` | medium | aspect-scaled | scaled media |
| `${variantPrefix}-Nx` (dynamic) | **400 / 800 / 1600 / 2400** | aspect-scaled | dynamic variant families (e.g. product banners/panels) request `prefix`, `prefix-2x`, `prefix-4x`, `prefix-6x` at these widths |
| CartPage thumbnail | ~100 | aspect-scaled | `CartPage` cart-card thumbnails |

`aspect` is the listing-image aspect ratio from `/design/layout.json` (currently 4/3). The dynamic `${variantPrefix}-Nx` pattern means the service must accept variants by **convention** (prefix + DPR suffix at the four widths), not only by a fixed name list.

---

## 6. Authorization model

| Guard | Rule |
|---|---|
| `AuthGuard` | Resolves principal + scope from token (dual transport §2). |
| `ScopeGuard` | Endpoint declares required scope (`@Scopes('user')`, `@Scopes('trusted')`). |
| `PermissionsGuard` | Checks `UserPermission` (post-listings / initiate-tx / read) — replaces Sharetribe permission set. |
| `OperatorGuard` | Admin/ops endpoints require an operator role + audit (`AuditLog`, actor from authenticated operator — replaces shared `x-admin-secret`). |
| `ServiceGuard` | `/internal/*` (scheduler, sweepers, orchestrator callbacks) require a service credential — replaces `X-Sweeper-Token`. |
| Webhooks | HMAC signature verification (Stripe/Shippo/LiveKit) + replay protection. |

Ownership checks (seller owns listing, party-to-order) enforced in services. Restricted/banned gates per AUTH-12.

---

## 7. Migration-critical auth rules (do not violate)

1. Keep `public-read` vs `user` vs `trusted` distinct; never issue trusted to a browser.
2. Preserve the cookie **and** `X-Native-Token` dual path and the "prefer user scope, don't let a stale anon cookie win" rule.
3. Keep `/auth/info` resolving before `/me` is fetched (boot ordering).
4. Keep the `permissionsLoaded` gate so partial hydration doesn't trigger false access-denied redirects.
5. Reproduce IdP auto-create + native `pastel://` hand-off + 20s hop timeout.
6. Any auth change ships with native cold-start verification (a regression here = total lockout).
