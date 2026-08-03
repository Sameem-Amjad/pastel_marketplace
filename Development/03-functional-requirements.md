# 03 — Functional Requirements (the full build inventory)

> Everything the new backend must do, organized by module, traced to the current implementation. This is the "what we need to build" checklist. Behavioral deep-dives for the hardest areas live in docs 04 (transactions/payments), 05 (search), 06 (auth/API).

Legend: **FR** = functional requirement. "Source" points at today's behavior so semantics are preserved.

---

## 1. Identity & Auth

| FR | Requirement | Source |
|---|---|---|
| AUTH-1 | Email/password signup → user row, hash password (Argon2id), send buyer verification email, auto-login. | `auth.duck.js` signup, `send-buyer-verification-email.js` |
| AUTH-2 | Email/password login → issue access token (scope `user`) + rotating refresh token. | `sdk.login`, `auth.duck.js` |
| AUTH-3 | Logout → revoke refresh token, clear cookie. | `sdk.logout` |
| AUTH-4 | Social login (Google, Apple web, Apple native, Facebook): OAuth flow → find-or-create user → auto-link IdP → issue tokens. First login auto-creates account; set `agreedToTermsAt`. | `auth/loginWithIdp.js`, `auth/{google,apple,apple-native,facebook}.js`, `createUserWithIdp.js` |
| AUTH-5 | Native OAuth deep-link hand-off: return token to the app via `pastel://` callback bridge; 20s per-hop timeout. | `nativeCallbackBridge.js`, `mobile-link-handoff.js` |
| AUTH-6 | `currentUser.show` equivalent: hydrate profile + permissions + profile image + Stripe account; expose a `permissionsLoaded` gate. | `user.duck.js`, `effectivePermissionSet` |
| AUTH-7 | Update profile / change email / change password / update addresses. | `ProfileSettingsPage.duck.js`, `ContactDetailsPage.duck.js` |
| AUTH-8 | Password reset request + reset; email verification; buyer email verification bridge. | `passwordReset.*`, `verify-buyer-email.js` |
| AUTH-9 | Token scopes: `public-read` (anon), `user`, `trusted` (server-only, replaces `exchangeToken`). | `getSdk`/`getTrustedSdk` |
| AUTH-10 | Dual token transport: cookie (web) **and** `X-Native-Token` header (Capacitor); prefer the user-scoped one. | `server/api-util/sdk.js`, `nativeTokenStore.js` |
| AUTH-11 | Operator "login as" (impersonation) with audit. | `initiate-login-as.js`, `login-as.js` |
| AUTH-12 | Account states gate access: `restricted` blocks initiate-tx (403), `banned`/`deleted` block login. | `isLoginBlockedByUserAttributes`, restriction checks |
| AUTH-13 | Permissions model: post-listings / initiate-tx / read allow|deny (operator-controlled). | `admin-users.js` updatePermissions |
| AUTH-14 | **"Effectively verified" is a tri-signal OR**: a user counts as email-verified if ANY of `emailVerified` **OR** `buyerEmailVerified` **OR** `waitlistVerified` is true. `syncFlexEmailVerificationFromWaitlist` reconciles these signals at login / signup / hydration — preserve this reconciliation. | `syncFlexEmailVerificationFromWaitlist`, verification flags |
| AUTH-15 | **Terms capture parity (decision)**: `agreedToTermsAt` is captured on **IdP signup only** today (AUTH-4). Decide whether to ALSO capture it on email/password signup; default to capturing it on both. | `createUserWithIdp.js` (sets `agreedToTermsAt`); `auth.duck.js` signup (does not) |
| AUTH-16 | **Login-as audit is net-new**: the "login as" impersonation (AUTH-11) must record an audit trail; this audit logging does not exist today and is to be built. | net-new (pairs with `initiate-login-as.js`, `login-as.js`) |

Detail: doc 06.

---

## 2. Catalog (listings, categories, collections, reviews)

| FR | Requirement | Source |
|---|---|---|
| CAT-1 | Listing lifecycle: create draft → update → publish → close → reopen → discard draft → (soft) delete. | `EditListingPage.duck.js` ownListings.* |
| CAT-2 | Full listing schema: core attrs + all extended fields (categories L1–L3, materials, period, origin, condition, dimensions, weight, shipping fields, return policies, variants/sizes, originalPrice, certification, videos, AI data). | doc 02 §4; `EditListing*Panel.js` |
| CAT-3 | Per-listing stock with optimistic locking (CAS via `stockVersion`); support `oneItem`/`multipleItems`/infinite. Optional per-variant stock. | `compareAndSetStock`, `configListing.js` |
| CAT-4 | Auto-close listing when stock hits 0 after purchase. | `transactions.js handleStock` |
| CAT-5 | Image upload → object storage; ordered images; on-the-fly variants (`listing-card`, `square-small`, `scaled-*`, `listing-gallery*`, social) via `{w,h,fit}` contract. | `images.upload`, `sdkLoader.js` |
| CAT-6 | Video media (max 2) stored in object storage with thumbnails. | `EditListingPhotosPanel.js`, `files.js` |
| CAT-7 | Categories: nested taxonomy (≤3 levels), served read-only; category-conditional fields; nested filter validation (no orphan child level). | `categories.js`, `configHelpers` |
| CAT-8 | Collections (shop merchandising): CRUD, attach/detach listings, mirror on profile. | `ShopManagerCollectionsPage`, `CollectionsPage.duck.js` |
| CAT-9 | Reviews: store review (server-side), denormalize `ratingAvg`/`reviewCount` onto stats; query by subject/listing. | `listings.js storeReviews`, `reviews.query` |
| CAT-10 | View counters: atomic increment off the row (no read-modify-write); listing + user + shop views. | `incrementListingViews`, `users.js` |
| CAT-11 | Favorites/wishlist: add/remove, counts. | user `publicData.favourites`, `FavoritesPage` |
| CAT-12 | Bulk listing fetch (by ids) for live shows / management. | `getBulkListings` |
| CAT-12b | **Bulk listing-ID validation for the orchestrator**: `validateProductsBulk` validates Sharetribe **listing** IDs on behalf of the live-show orchestrator (a basic-auth-bypassing root mount). This is distinct from generic bulk listing fetch (CAT-12) — it is an existence/validity check, not a content fetch. | `validateProductsBulk.js` |
| CAT-16 | **Live-show product catalog (Firestore `products`)**: a SECOND product store — the Firestore `products` collection — is used by live shows and is distinct from Sharetribe listings. Decision: confirm in use → fold into `Listing` (preferred) or model as `Product` (doc 02). The dev-only `simpleProducts` / `productStore` in-memory store is **NOT** migrated. | `server/api/products.js`; `productStore.js` (dev-only) |
| CAT-13 | AI listing generation: image(s) → Gemini → title/description/category/metadata draft. | `ai-listing-generator.js` |
| CAT-14 | IndexNow ping on listing publish/change (SEO). | `indexnow.js` |
| CAT-15 | Sitemap entries for published listings. | `resources/sitemap.js` |

---

## 3. Search (millions of listings)

| FR | Requirement | Source |
|---|---|---|
| SRCH-1 | Faceted filter on extended data: enum (single), multi-enum with `has_all` (AND) / `has_any` (OR), numeric range, boolean, text. Only indexed fields are queryable. | `search.js`, `SearchPage.duck.js` |
| SRCH-2 | Category filter across L1/L2/L3 (nested). | `omitInvalidCategoryParams` |
| SRCH-3 | Price range filter (minor units). **Upper bound is sent as `max + 1` subunits** to make the range inclusive — match with a Postgres `BETWEEN low AND high` where `high = max + 1` (or `price >= low AND price < max+1`). | `priceSearchParams` (`inSubunits(values[1]) + 1`) |
| SRCH-4 | Full-text keyword search over title/description (+ relevance sort). | `keywords` filter |
| SRCH-5 | Geo search: origin (distance) + bounds (viewport). Capability present though currently config-disabled. | `isOriginInUse`, `configMaps.js` |
| SRCH-6 | Stock filter (hide sold-out) for product processes. **Tri-state, not a boolean**: the filter sends `minStock: 1` **plus** `stockMode: 'match-undefined'`, which KEEPS listings that have NO `stock` field at all (e.g. infinite-stock / non-product listings). A naive `in_stock = true` wrongly drops them — encode this as tri-state (`stock >= 1 OR stock IS NULL`). Deferred together with the dates/seats booking params. | `stockFilters` (`{ minStock: 1, stockMode: 'match-undefined' }`) |
| SRCH-7 | Sort: `createdAt`, `-createdAt`, `price`, `-price`, `relevance`. | `sortConfig` |
| SRCH-8 | Cursor (keyset) pagination; sparse field sets; include author + primary image. | doc 05; `fields.listing`, `include` |
| SRCH-9 | Author/shop listing queries; "ids" fetch; state/`published` scoping. | `listings.query` variants |
| SRCH-10 | **Dates / seats search params are deferred WITH the booking process** (ORD-5). The query plumbing exists today but is dormant; build the search seam only when booking is activated. | `hasDatesFilterInUse` (bypasses stock filter when set) |

Detail: doc 05.

---

## 4. Orders / Transactions (the engine)

| FR | Requirement | Source |
|---|---|---|
| ORD-1 | Implement the **instant-purchase** process (primary): create-PI → request-payment → confirm-payment (capture) → purchased → confirm-order → shipped → delivered → received (payout) → completed → reviewed. | `ext/.../instant-purchase/process.edn` |
| ORD-2 | Implement **cart-stock** reservation process (15-min hold, confirm/expire/cancel). | `cart-stock-process` |
| ORD-3 | Implement **default-purchase** (single/cart-parent legacy). | `default-purchase` |
| ORD-4 | Implement **inquiry** (free message, no payment). | `default-inquiry` |
| ORD-5 | **Booking** process: defer (dormant today) but keep schema seam. | `default-booking` (commented out) |
| ORD-6 | Time-based transitions: `expire-payment` PT15M, `auto-cancel` P3D/P14D, `auto-mark-received` P14D, review expiries P7D, `auto-cancel-from-disputed` P60D, partial-refund auto-release P14D. | EDN `:time` transitions |
| ORD-7 | Speculative pricing (no side-effects) for checkout preview. | `initiateSpeculative` |
| ORD-8 | Privileged initiate/transition: server computes line items, validates promo+tax, never trusts client prices. | `initiate-privileged.js`, `transition-privileged.js` |
| ORD-9 | Cart: per-user cart (add/update/remove), multi-seller split into child orders, per-item variant/size/qty. | `CartPage.duck.js` |
| ORD-10 | Messaging within an order (send/list). | `messages.send/query` |
| ORD-11 | Reviews lifecycle (two-sided, publish after period). | review transitions |
| ORD-12 | Disputes: open dispute, replacement, approve/decline refund/replacement, operator escalation. | EDN dispute branch |
| ORD-13 | Order queries: buyer "orders", seller "sales", filter by state/transitions; inbox of message-bearing orders. | `transactions.query`, `InboxPage` |
| ORD-14 | Order email reminders (scheduled nudges). | `order-email-reminders-sweep.js` |

Detail: doc 04.

---

## 5. Pricing (financial trust boundary)

| FR | Requirement | Source |
|---|---|---|
| PRC-1 | Single-item line items: item (price×qty), shipping (one + addl), pickup (0), sales tax, provider commission (−%), customer commission (+%). | `lineItems.js` |
| PRC-2 | Cart line items: per-listing items, fixed vs carrier shipping with multi-item discount rules, app promo (percentage or free-shipping), commission on item subtotal only. | `cartLineItems.js` |
| PRC-3 | `includeFor` model: payin = Σ customer lines; payout = Σ provider lines; margin = payin − payout. | `lineItemHelpers.js` |
| PRC-4 | Money = integer minor units, `decimal.js` math, round HALF_UP; max 50 line items. | `lineItemHelpers.js` |
| PRC-5 | Commission sourced from `CommissionConfig` (replaces commission.json); only add line if % > 0. | `fetchCommission` |
| PRC-6 | Promo validation: global `Discount` + per-seller `ShopPromotion`, single-use per user, expiry, scope checks; record usage atomically on success. | `validate-discount.js`, `shop-promotions.js`, Firestore usages |

Detail: doc 04.

---

## 6. Payments (Stripe Connect — direct)

| FR | Requirement | Source |
|---|---|---|
| PAY-1 | Seller onboarding: create Custom Connect account, account links, refresh status; track requirements/charges/payouts enabled. | `stripeConnectAccount.duck.js` |
| PAY-2 | Customer + saved cards: create Stripe customer, SetupIntent, attach/detach payment methods, default PM. | `paymentMethods.duck.js` |
| PAY-3 | PaymentIntent create (with application fee = margin), client confirm (3DS/SCA), capture. | EDN stripe-* actions |
| PAY-4 | **Escrow**: hold captured funds on platform balance; release via transfer to seller at mark-received / P14D auto. | EDN `stripe-create-payout` |
| PAY-5 | Refunds: full (→canceled) and partial (proportional, →partially-refunded); pre-payout only auto; post-payout returns 409 (manual clawback). | `admin-refunds.js`, `refunds/*` |
| PAY-6 | Refund eligibility rules + speculative-then-commit preview; metadata audit (`lastOperatorAction`). | `eligibility.js`, `refunds/lineItems.js` |
| PAY-7 | Webhooks: `account.updated`, `payment_intent.*`, `charge.refunded`, `transfer.*`, `charge.dispute.created`; idempotent via `StripeEvent`. | new (Sharetribe absorbed these) |
| PAY-8 | Payout/refund retries via queue; never double-pay/double-refund (idempotency keys). | new |

Detail: doc 04.

---

## 7. Tax (TaxJar) & Shipping (Shippo)

| FR | Requirement | Source |
|---|---|---|
| TAX-1 | Rate resolution: live TaxJar `POST /v2/taxes`, static `tax.json` fallback; US-only; nexus gate (seller + platform nexus states); null for pickup. | `taxjar.js` |
| TAX-2 | Add sales-tax line item at initiate AND transition (recompute, never trust); write `salesTaxSnapshot`. | `taxLineItems.js` |
| TAX-3 | Report orders/refunds to TaxJar on order create / refund events; ids `pastel-{orderId}` / `pastel-refund-{orderId}-{suffix}`. | `taxjarSync.js` |
| TAX-4 | Admin TaxJar CRUD + sync endpoints. | `taxjar-transactions.js` |
| SHIP-1 | Address validate/parse, get rates, get specific rate, create label. | `shippo.js` |
| SHIP-2 | Manual tracking entries (save/read) per order. | `order-tracking.js` |
| SHIP-3 | Seller fixed shipping vs carrier (Shippo live) rate at checkout. | `cartLineItems.js` |

Detail: doc 04.

---

## 8. Social (follow, stories, highlights, favorites)

| FR | Requirement | Source |
|---|---|---|
| SOC-1 | Follow/unfollow; remove follower; follow status + counts; followers/following lists (paginated, enriched, live-status). | `follow.js`, `unfollow.js`, `followers-list.js`, `following-list.js` |
| SOC-2 | Follow events emit notification + email to followed user. | `follow.js` |
| SOC-3 | Stories: create (signed-URL upload), share, get by user/listing/id, update, delete, 24h expiry sweep. | `user-stories.js` |
| SOC-4 | Story likes: initialize, toggle, get likes. | `story-likes.js` |
| SOC-5 | New public story notifies followers. | `user-stories.js` |
| SOC-6 | Highlights: create, add story, update, delete, get by user; cover story. | `highlights.js` |
| SOC-7 | Handle/username: reserve, resolve handle→user, uniqueness. | `username.js` |
| SOC-8 | Invite/referral tracking (proxy to tools service or in-house). | `invite-tracking.js`, `invite-tools.js` |

---

## 9. Notifications & Push

| FR | Requirement | Source |
|---|---|---|
| NOT-1 | In-app notification feed: list (per recipient mode), unread count, unread-message-orders, mark-read, mark-order-read. | `notifications.js` |
| NOT-2 | Producers for the full notification type set (~32 canonical types): order transitions, new message, new order to seller, follow, story, product-created, shop-created, live/upcoming-live, refunds, disputes, reviews, seller-approved, etc. **The canonical type list, per-mode subsets, and producer→type map are enumerated in the Notification Catalog appendix (§9.1)** — that appendix is authoritative; do not treat this row's summary as exhaustive. | `notifications.js`; see §9.1 |
| NOT-3 | Preferences: per-type priority (low/default/high) + per-mode enable/disable; gate push + email. | `notificationPreferences` |
| NOT-4 | Push: register/revoke FCM token; fan-out on notification create via FCM `sendEachForMulticast`; revoke dead tokens. (Replaces Firestore onCreate trigger with outbox→push worker.) | `register-push-token.js`, Cloud Function |
| NOT-5 | Email: order emails, follower emails, buyer welcome/verification, restriction emails (Mailgun + templates). | `order-emails.js`, `mail.js` |
| NOT-6 | Scheduled order-email reminders sweep. | `order-email-reminders-sweep.js` |
| NOT-7 | **Stale-notification cleanup**: at read time, hide (and lazily delete) product/story/live notifications whose underlying entity is gone — unpublished/out-of-stock listing, expired story, ended/deleted show. The new feed must reproduce this via read-time FK joins (entity-existence check on the feed query) or a purge worker. | `notifications.js` `filterStaleFollowActivityNotifications()` + `purgeStaleNotificationDocs()` |

### 9.1 Notification catalog (canonical type list — authoritative)

> Source of truth: the `functions/index.js` push-routing switch, `server/api/notifications.js` (`NOTIFICATION_TYPES_ALL`, the per-mode configurable + feed-visible allow-lists), and `server/api-util/order-transition-specs.js` (`ORDER_TRANSITION_NOTIFICATIONS`). The new feed/preferences/push code must preserve these exact type strings.

**Canonical types (~32).** The complete set the system can emit:

`story`, `product`, `live`, `upcoming_live`, `follow`, `order`, `order_confirmed`, `order_canceled`, `order_canceled_by_buyer`, `order_canceled_seller`, `shipping_reminder`, `order_received_reminder`, `order_shipping_expired`, `order_auto_received`, `order_received_from_dispute`, `refund_issued`, `refund_partial`, `payment_expired`, `order_delivered_by_operator`, `review_requested`, `review_other_party`, `review_other_party_published`, `order_shipped`, `order_delivered`, `order_received`, `order_disputed`, `dispute_approved`, `dispute_rejected`, `dispute_escalated`, `message`, `shop_created`, `seller_approved`.

> Note: NOT-2's summary historically omitted several of these — explicitly including: `payment_expired`, `refund_partial`, `order_delivered_by_operator`, `order_received_from_dispute`, `order_auto_received`, `order_shipping_expired`, `seller_approved`, `shop_created`, `upcoming_live`, `live`, `order_canceled_by_buyer`, `order_canceled_seller`, plus the review sub-types (`review_requested` / `review_other_party` / `review_other_party_published`) and dispute sub-types (`order_disputed` / `dispute_approved` / `dispute_rejected` / `dispute_escalated`). `NOTIFICATION_TYPES_ALL` in `notifications.js` does not list `refund_partial` / `payment_expired` (they arrive only via the order-transition spec) — the new model must accept them too.

**Per-mode configurable subsets** (user-toggleable via preferences; system-only types are excluded):

- **`BUYER_CONFIGURABLE_TYPES`**: `story`, `product`, `live`, `upcoming_live`, `order_confirmed`, `order_canceled`, `order_shipped`, `order_delivered`, `order_received_reminder`, `order_shipping_expired`, `order_auto_received`, `order_received_from_dispute`, `refund_issued`, `review_requested`, `review_other_party`, `review_other_party_published`, `dispute_approved`, `dispute_rejected`, `dispute_escalated`, `message`.
- **`SELLER_CONFIGURABLE_TYPES`**: `follow`, `order`, `order_received`, `order_canceled_by_buyer`, `order_canceled_seller`, `shipping_reminder`, `order_shipping_expired`, `order_auto_received`, `order_received_from_dispute`, `refund_issued`, `order_delivered_by_operator`, `review_requested`, `review_other_party`, `review_other_party_published`, `order_disputed`, `dispute_escalated`, `upcoming_live`, `message`.

**Feed-visible-per-mode allow-lists** (`allowedTypesForMode(mode)` → `BUYER_NOTIFICATION_TYPES` / `SELLER_NOTIFICATION_TYPES`): the feed list + unread-count queries filter `type IN (allow-list)` per the recipient's current mode. Preserve these allow-lists as the feed/unread-count filter (the new query must scope by recipient mode the same way).

**PRODUCER → type map** (which module emits which types):

| Producer | Types emitted |
|---|---|
| `notifications.js` (order-events processor + message recorder) | all `order_*`, `refund_*`, `payment_expired`, `dispute_*`, `review_*`, `message`, `shop_created`, `seller_approved` (via `ORDER_TRANSITION_NOTIFICATIONS`) |
| `follow.js` | `follow` |
| `user-stories.js` | `story` (and product/story follow-activity) |
| `waitlist.js` | `seller_approved` / onboarding-related |
| `orchestrator-proxy.js` | `live`, `upcoming_live` (schedule/clear show reminders) |
| `order-email-reminders-sweep.js` | `shipping_reminder`, `order_received_reminder` |
| order-transition / order-events processor | the `ORDER_TRANSITION_NOTIFICATIONS` set (see `order-transition-specs.js`) |

**Special cases the new system must reproduce:**

- **`upcoming_live` is a SCHEDULED notification**: deterministic doc id `upcoming_live_{showId}_{followerId}`, created ~1h before the show, and **cleared on show start / end**. Model it as a scheduled job keyed by that deterministic id so it can be canceled.
- **Order-transition notifications are deduped** by the tuple `(recipientUserId, orderId/transactionId, type)` — see `notificationAlreadyExists()`. The new writer must enforce the same uniqueness so a re-driven transition does not double-notify.

---

## 10. Live shows

| FR | Requirement | Source |
|---|---|---|
| LIVE-1 | Join show: validate user, call orchestrator to mint LiveKit token; mirror to Postgres index. | `live-join.js`, `shows-secure.js` |
| LIVE-2 | Show CRUD index: list/filter (orchestrator primary + Postgres fallback), get, update (creator only), end, delete, active-by-creator. | `shows-*.js` |
| LIVE-3 | Orchestrator proxy: forward to `api.ivector.co`, inject authed userId, mirror metadata, schedule/clear show-reminder notifications. | `orchestrator-proxy.js` |
| LIVE-4 | LiveKit webhook (HMAC) → drive seller-disconnect grace window. | `livekit-webhook.js` |
| LIVE-5 | Grace-window sweeper: end shows whose seller didn't reconnect (every ~1 min). | Cloud Function `expireLiveShowGrace` → `shows-end.js` |

---

## 11. Config / CMS (replaces Sharetribe hosted assets)

| FR | Requirement | Source |
|---|---|---|
| CFG-1 | Serve listing types, listing fields, user types, user fields, search config, categories, branding, layout, localization, access-control **and the additional hosted assets** — `minimum-transaction-size.json`, `integrations/google-search-console.json`, `integrations/analytics.json` (GA integration config, distinct from internal `AnalyticsDaily`), `content/footer.json`, `content/top-bar.json`, `integrations/map.json` — as DB-backed config (`ConfigAsset`). Preserve the `denormalizeAssetData` step and the version / `'latest'` alias contract (each asset is fetched by version or the `latest` alias). Cross-ref doc 06. | `hostedAssets.duck.js`, `appCdnAssets`, `denormalizeAssetData` |
| CFG-2 | Serve CMS pages (landing, terms, privacy, custom) with versioning. | `fetchPageAssets`, `CMSPage` |
| CFG-3 | Serve translations bundles per locale. | `/content/translations.json` |
| CFG-4 | Commission config endpoint (operator-editable). | commission.json |
| CFG-5 | Native runtime config (live-webview flag, allowed builds). | `native-config.js` |
| CFG-6 | The frontend's `mergeConfig(hosted, default)` pipeline must keep working (shape compatibility). | `configHelpers.js` |

---

## 12. Admin / Ops / Compliance

| FR | Requirement | Source |
|---|---|---|
| ADM-1 | User management: list/get/restrict/unrestrict/change-type/reset-profile/delete/restore/complete-deletion; stats. | `admin-users.js` |
| ADM-2 | Refund/dispute console endpoints (list refundable, detail, refund, release, replacement, auto-escalated). | `admin-refunds.js`, `admin-transactions.js` |
| ADM-3 | Restriction appeals: submit + admin review (with attachment). | `restriction-appeals.js` |
| ADM-4 | Content/DMCA reports: submit → moderation queue + email designated agent. | `report-content.js` |
| ADM-5 | Account deletion: authenticated + public-by-email requests; erase/flag (data **EXPORT** is net-new, to be built — current code only flags/erases, there is no data export/portability today). | `account-deletion-request.js`, `public-deletion-request.js` |
| ADM-6 | Waitlist + referrals: signup, verify, status, address, priority, admin approve/revoke. | `waitlist.js` |
| ADM-7 | Audit log for all operator actions (`x-admin-actor` → `AuditLog`). | `requireAdminSecret`, metadata |
| ADM-8 | Analytics: track events (page_view, signup, cart_add, checkout funnel…) into `AnalyticsDaily`; summary API. | `analytics-events.js` |
| ADM-9 | Native telemetry: native-log ring buffer (7-day TTL, backed by `NativeLog` in doc 02), device-bundle adoption (backed by `DeviceBundle` in doc 02), OTA bundle manifest. | `native-log.js`, `device-bundle.js`, `bundle-manifest.js`; doc 02 `NativeLog`, `DeviceBundle` |
| ADM-10 | Operator auth via dedicated credential/role (replaces `x-admin-secret`); internal sweeper auth (replaces `X-Sweeper-Token`). | `apiRouter.js` |

---

## 13. Media

| FR | Requirement | Source |
|---|---|---|
| MED-1 | Signed upload URLs (image/video) to object storage; direct upload + multipart fallback. | `files.js` |
| MED-2 | Image variant URLs: `{w,h,fit}` → resized via image service + CDN; preserve variant-name contract. | `sdkLoader.js` |
| MED-3 | Signed download URLs for private media (appeal attachments). | `getSignedDownloadUrlForStorageUrl` |
| MED-4 | Video thumbnail handling (client generates first-frame thumb; we store). | `storyVideoThumbnail.js` |

---

## 14. Platform / cross-cutting

| FR | Requirement | Source |
|---|---|---|
| PLT-1 | Transactional outbox + relay (events → search, push, email, TaxJar, webhooks). | new |
| PLT-2 | Scheduler/worker for `ScheduledTransition`, reservation expiry, story expiry, reminders, grace sweep. | replaces EDN timers + Cloud Functions |
| PLT-3 | Idempotency keys for mutating endpoints + outbound calls. | new |
| PLT-4 | Rate limiting + abuse protection (Redis). | new (Cloudflare today) |
| PLT-5 | Observability: traces, metrics, logs, Sentry; health/readiness probes. | `log.js` (Sentry today) |
| PLT-6 | API response compatibility layer: JSON:API `{data, included, meta}`, UUID-as-`{uuid}`, `Money{amount,currency}`, transit codec during cutover window. | doc 06 |
| PLT-7 | SSR data-loading contract: serve the per-route `loadData` payloads the existing renderer expects (config + entities), so SSR keeps working pointed at the new API. | `dataLoader.js`, `pageDataLoadingAPI.js` |
| PLT-8 | **SSR tier retained**: loadable-component chunk extraction, preloaded-state serialized via transit, `fetchAppAssets`-before-`loadData` ordering, HTTP status-code injection (404/error pages), and the `PREVENT_DATA_LOADING_IN_SSR` escape hatch. Cross-ref doc 01 SSR section. | `server/renderer`, `dataLoader.js`, `loadable`, transit codec |
| PLT-9 | **OTA hosting preserved on the web origin**: serve `/api/bundle-manifest`, `/static/*` with CORS + CORP headers, and the build-time `patch-ota-publicpath` / `build-ota-index` steps so installed native shells keep pulling JS bundles over the air. Cross-ref doc 01 OTA section. | `bundle-manifest.js`, OTA build scripts |
| PLT-10 | **Native app-links** (critical for native deep-link auth): host-aware `/.well-known/apple-app-site-association` (with AASA-excluded hosts) and `/.well-known/assetlinks.json`. Breakage here silently breaks native deep-link / OAuth hand-off. Cross-ref doc 01 app-links section. | `.well-known/apple-app-site-association`, `.well-known/assetlinks.json` |
| PLT-11 | **SEO / resource routes**: `robots.txt`, `site.webmanifest`, IndexNow key file, multi-sub-sitemap (with private-marketplace gating), basic-auth staging gate, and CSP nonce injection + `/csp-report` endpoint. Cross-ref doc 01 SEO routes section. | `resources/*`, `sitemap.js`, `indexnow.js`, CSP middleware |
| PLT-12 | **SSR HTML endpoints**: `/invite/:handle` (server-rendered invite page), `/verify-email` bridge, and the `mobile-link-handoff` middleware. Cross-ref doc 01. | `invite` route, `verify-buyer-email.js`, `mobile-link-handoff.js` |

---

## 15. Dead code & dev-only endpoints — explicitly NOT migrated

> Listed so the inventory is unambiguous: each of these is intentionally dropped (dead, dev-only, diagnostic, or superseded). None carries a behavioral requirement in the new backend.

| Endpoint / module | Why dropped |
|---|---|
| `update-transaction-metadata.js` | **Dead** — unwired (not mounted in `apiRouter.js`). Not migrated. |
| `shows-secure.js` | **Dead** — superseded by `live-join.js`. Not migrated. |
| `dev-login` | **Dev-only** — local login shortcut. Not migrated. |
| `test-firebase` | **Diagnostic** — Firebase connectivity probe. Not migrated. |
| `discount-debug` + `discountDebugLog` | **Temp debug** — discount troubleshooting. Not migrated. |
| `dummy-data` | **Dev-only** — seed/fixture generator. Not migrated. |
| `simpleProducts` / `productStore` | **Dev-only in-memory** product store (distinct from the live-show Firestore `products`, see CAT-16). Not migrated. |
| OIDC proxy well-known endpoints | **Sharetribe SSO** OIDC proxy — dropped (no longer fronting Sharetribe auth). Not migrated. |

---

## 16. Explicitly out of scope for v1 (decide later)

- **Booking process** (`default-booking`) — code exists but is dormant in the registry. Build schema seam; defer engine unless a product need arises.
- **Phase-B search engine** (OpenSearch/Typesense) — only when Postgres FTS metrics demand it (doc 05).
- **Multi-currency** beyond what listings already declare — current flows are effectively USD; design keeps `currency` per money value but v1 operational currency stays as today.
- **Team/multi-user seller accounts** — noted as "future" in the overview doc; not built v1.

---

## 17. Traceability

Every FR above maps to: a module (doc 01 §4), one or more tables (doc 02), and — for the hard subsystems — a behavioral spec (doc 04/05/06). The migration plan (doc 07) sequences these into deliverable phases and defines the data backfill for each.
