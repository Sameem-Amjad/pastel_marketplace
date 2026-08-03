# 02 — Data Model (PostgreSQL / Prisma)

> The complete relational schema that replaces Sharetribe's data model + the Firebase business collections. Expressed as Prisma models grouped by module. Read [`01-architecture-and-system-design.md`](./01-architecture-and-system-design.md) first.

---

## 1. Modeling principles

1. **Core columns + JSONB long-tail.** Sharetribe split data into "built-in attributes" and "extended data" (`publicData`/`privateData`/`protectedData`/`metadata`). We mirror that: promote every field that is **filtered, sorted, joined, or money** into a typed column; keep the rare/variable long-tail in `JSONB` columns (`public_data`, `private_data`, `metadata`). This keeps queries fast and the schema honest while preserving flexibility.
2. **Money = integer minor units.** `BIGINT` cents + `CHAR(3)` currency. Never `float`/`numeric` for money totals.
3. **UUID v7 primary keys.** Time-ordered UUIDs (good index locality; externally opaque). The API encodes them as Sharetribe-style `{uuid}` during the compat window (doc 06).
4. **Soft delete** via `deleted_at TIMESTAMPTZ NULL` where Sharetribe had a `deleted` flag (users, listings).
5. **`timestamptz` everywhere.** The Firebase data mixed `Timestamp` and ISO strings — we normalize to `timestamptz`.
6. **Every cross-module reference is an explicit FK** (replacing Firestore's loose `userId`/`listingId`/`transactionId` strings), with `ON DELETE` policies chosen per relationship.
7. **No module reads another module's tables**; the FKs exist for integrity, access goes through services.

> Notation: Prisma schema below is illustrative (datasource/generator blocks omitted). `@db.*` native types and `@@index`/`@@unique` are shown where they matter. Phase-B search-engine fields are noted but not duplicated here.

---

## 2. Enums

```prisma
enum UserType        { customer seller provider } // guest = unauthenticated, not a row
enum AccountStatus   { active restricted banned deleted }
enum ListingState    { draft pendingApproval published closed }
enum StockType       { oneItem multipleItems infiniteOneItem infiniteMultipleItems }
enum DeliveryMethod  { shipping pickup both }
enum OrderProcess    { instant_purchase default_purchase cart_stock inquiry booking }
enum LineItemCode {
  item shipping_fee pickup_fee shipping_discount sales_tax
  app_promo_discount provider_commission customer_commission
}
enum IncludeFor      { customer provider }      // line items carry a set of these
enum StripeAcctStatus{ none onboarding restricted enabled }
enum RefundMode      { full partial }
enum RefundResolution{ refund release replacement }
enum NotificationChannelPriority { low default high }
enum ShowStatus      { scheduled live ended }
enum MediaType       { image video }
enum OutboxStatus    { pending sent failed }
```

The **order states** and **transitions** are *not* enums — they are data (a process registry), so we can add states/transitions without migrations. See §5 and doc 04.

---

## 3. Identity & Auth

```prisma
model User {
  id              String        @id @default(dbgenerated("uuidv7()")) @db.Uuid
  email           String        @unique
  emailVerified   Boolean       @default(false)
  pendingEmail    String?
  passwordHash    String?       // null for IdP-only accounts (Argon2id)
  userType        UserType      @default(customer)
  accountStatus   AccountStatus @default(active)
  restrictedAt    DateTime?
  restrictionReason String?

  // Profile (was Sharetribe profile.*)
  firstName       String?
  lastName        String?
  displayName     String?
  bio             String?
  handle          String?       @unique         // shop/username handle
  businessName    String?
  businessType    String?
  aboutShop       String?
  profileImageId  String?       @db.Uuid
  isTopSeller     Boolean       @default(false)

  // Extended buckets (the long tail of publicData/privateData/protectedData/metadata)
  publicData      Json          @default("{}")  // newsletter, views, misc public
  privateData     Json          @default("{}")  // payoutAddress, accountDeletionStatus, loginDisabled
  protectedData   Json          @default("{}")  // phoneNumber, agreedToTermsAt, buyerEmailVerified, waitlistVerified
  metadata        Json          @default("{}")  // operator-set flags
  // "Effectively verified" rule (userHelpers.isEmailEffectivelyVerified): a user counts as verified if
  // ANY of emailVerified (column above) OR protectedData.buyerEmailVerified OR protectedData.waitlistVerified
  // is true. syncFlexEmailVerificationFromWaitlist reconciles waitlist verification into native
  // emailVerified at login / signup / currentUser hydration (auth.duck.js, user.duck.js).

  // Counts (denormalized; maintained by triggers/services)
  followersCount  Int           @default(0)
  followingCount  Int           @default(0)

  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  deletedAt       DateTime?

  // relations
  profileImage    MediaAsset?   @relation("UserProfileImage", fields: [profileImageId], references: [id])
  listings        Listing[]
  idpLinks        IdpLink[]
  permissions     UserPermission?
  addresses       Address[]
  stripeAccount   StripeAccount?
  stripeCustomer  StripeCustomer?
  collections     Collection[]
  cart            CartItem[]

  @@index([handle])
  @@index([userType, accountStatus])
  @@index([isTopSeller])
}

// Replaces Sharetribe effectivePermissionSet (the permissionsLoaded gate, doc 06)
model UserPermission {
  userId          String   @id @db.Uuid
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  postListings    String   @default("permission/allow")   // allow|deny
  initiateTx      String   @default("permission/allow")
  read            String   @default("permission/allow")
  updatedAt       DateTime @updatedAt
}

model IdpLink {                 // Google / Apple / Facebook
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String   @db.Uuid
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider    String   // google | apple | facebook
  providerUid String
  createdAt   DateTime @default(now())
  @@unique([provider, providerUid])
}

model Credential {             // refresh-token / session rotation (doc 06)
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId        String   @db.Uuid
  refreshHash   String   // hashed rotating refresh token
  scope         String   @default("user")  // user | trusted
  userAgent     String?
  ip            String?
  expiresAt     DateTime
  revokedAt     DateTime?
  createdAt     DateTime @default(now())
  @@index([userId])
}

model EmailToken {             // email verification + password reset + buyer verification
  id        String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId    String?  @db.Uuid
  email     String
  kind      String   // verify_email | reset_password | buyer_verification
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
  @@index([email, kind])
}

model Address {
  id          String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String  @db.Uuid
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  label       String?
  recipient   String?
  street1     String
  street2     String?
  city        String
  state       String?
  postalCode  String?
  country     String
  isDefault   Boolean @default(false)
  @@index([userId])
}
```

---

## 4. Catalog

```prisma
model Category {              // replaces the hardcoded tree in server/api/categories.js
  id         String     @id            // stable slug, e.g. "ceramic"
  name       String
  parentId   String?
  parent     Category?  @relation("CatTree", fields: [parentId], references: [id])
  children   Category[] @relation("CatTree")
  level      Int                          // 1..3
  path       String                       // ltree-style "ceramic.porcelain.plate"
  sortOrder  Int        @default(0)
  active     Boolean    @default(true)
  @@index([parentId])
  @@index([path])
}

model Listing {
  id            String       @id @default(dbgenerated("uuidv7()")) @db.Uuid
  authorId      String       @db.Uuid
  author        User         @relation(fields: [authorId], references: [id])
  title         String       @default("Draft")
  description   String?
  state         ListingState @default(draft)

  // Money
  priceAmount   BigInt?                     // minor units
  priceCurrency String?      @db.Char(3)
  originalPriceAmount BigInt?
  costAmount    BigInt?

  // Type / process
  listingType   String       @default("instant-purchase")
  processAlias  String       @default("instant-purchase/release-14")
  unitType      String       @default("item")

  // Categories (denormalized ancestors → equality-indexable filters)
  categoryL1    String?
  categoryL2    String?
  categoryL3    String?
  otherCategory String?

  // Stock (per-listing; per-variant optional via ListingVariant)
  stockType     StockType    @default(multipleItems)
  stockQuantity Int          @default(0)
  stockVersion  Int          @default(0)   // optimistic lock (replaces compareAndSet)

  // Delivery / shipping
  deliveryMethod DeliveryMethod @default(shipping)
  shippingEnabled Boolean     @default(true)
  pickupEnabled  Boolean      @default(false)
  freeShipping   Boolean      @default(false)
  shippingType   String?                    // fixed | custom
  shipOneItemAmount BigInt?                  // shippingPriceInSubunitsOneItem
  shipAddlItemAmount BigInt?                 // shippingPriceInSubunitsAdditionalItems

  // Geo (PostGIS) — optional; geo search dormant today but supported
  geo            Unsupported("geography(Point,4326)")?

  // Provenance / descriptive (filterable subset promoted)
  condition      String?
  period         String?
  origin         String?
  materials      String[]                    // text[]; multi-enum has_all/has_any via GIN
  certification  String?

  // The long tail (dimensions, weight, parcelData, return policies, AI data, shipping options...)
  publicData     Json         @default("{}")
  privateData    Json         @default("{}")
  metadata       Json         @default("{}")

  // AI generation
  aiGeneratedData Json?
  aiDataGenerated Boolean      @default(false)

  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  publishedAt    DateTime?
  deletedAt      DateTime?

  images         ListingImage[]
  media          ListingMedia[]
  variants       ListingVariant[]
  reviews        Review[]
  stats          ListingStats?
  collections    CollectionListing[]

  @@index([authorId, state])
  @@index([state, createdAt])              // default sort
  @@index([state, priceAmount])            // price sort/filter
  @@index([categoryL1, categoryL2, categoryL3])
  @@index([listingType])
  // GIN(materials), GIN(to_tsvector(title||description)), GiST(geo), trigram(title) — see doc 05
}

model ListingImage {
  id         String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  listingId  String   @db.Uuid
  listing    Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)
  assetId    String   @db.Uuid               // → MediaAsset
  position   Int      @default(0)
  @@index([listingId, position])
}

model ListingMedia {                          // videos (was publicData.videos, Firebase URLs)
  id          String    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  listingId   String    @db.Uuid
  listing     Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)
  type        MediaType
  url         String
  thumbnailUrl String?
  position    Int       @default(0)
}

model ListingVariant {                        // optional per-variant stock (Sharetribe couldn't do this)
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  listingId   String   @db.Uuid
  listing     Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)
  sku         String?
  optionName  String?                          // e.g. "size"
  optionValue String?                          // e.g. "M"
  priceDeltaAmount BigInt @default(0)
  stockQuantity Int      @default(0)
  stockVersion  Int      @default(0)
}

model ListingStats {                           // counters OFF the row (no read-modify-write on Listing)
  listingId    String  @id @db.Uuid
  listing      Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
  viewCount    BigInt  @default(0)
  favoriteCount BigInt @default(0)
  ratingAvg    Float   @default(0)
  reviewCount  Int     @default(0)
  updatedAt    DateTime @updatedAt
}

model Collection {                             // shop merchandising (was user publicData.collections)
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  ownerId     String   @db.Uuid
  owner       User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name        String
  description String?
  createdAt   DateTime @default(now())
  listings    CollectionListing[]
  @@index([ownerId])
}

model CollectionListing {
  collectionId String   @db.Uuid
  listingId    String   @db.Uuid
  position     Int      @default(0)
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  listing      Listing    @relation(fields: [listingId], references: [id], onDelete: Cascade)
  @@id([collectionId, listingId])
}

// Live-show product catalog (legacy Firestore `products`, server/api/products.js).
// DISTINCT from Sharetribe `Listing`: a lightweight seller-owned product used by
// live shows — the Show references these by id array (Show.productIds), consumed via
// src/util/productsAPI.js + liveShows.duck.js (fetchSellerProducts / getBulkProducts).
// DECISION NEEDED: confirm still in use → either fold into `Listing` (PREFERRED — make
// live shows reference listings) or keep as this lightweight entity. The dev-only
// in-memory `simpleProducts`/`productStore` is NOT migrated.
model Product {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  sellerId    String   @db.Uuid          // Sharetribe user UUID of owner (immutable after create)
  title       String
  description String?                     // defaults null
  price       BigInt                      // minor units (Firestore stored a plain number; promote to cents)
  quantity    Int?                        // nullable in source
  images      String[]                    // image URLs ([] default)
  status      String   @default("active") // active | inactive
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([sellerId, status])
}
```

### 4.1 `Listing.publicData` JSONB long-tail (do not lose at migration)

§4 promotes the *filterable* subset to columns and relegates the rest to `publicData`. This is the
explicit catalogue of those long-tail shapes so the migration ETL knows what to carry. Key names are
**verbatim from the editor panels** (case matters). Several are landmines — flagged inline.

**(a) Return / exchange policy** (`EditListingPricingAndStockPanel`, `ReturnAndExchangePolicyModal`)
```jsonc
{
  "returnAndExchangePolicies": [{
    "id": "…", "policyName": "…", "returnWindow": "…",
    "resolutionType": "…", "shippingCostPayer": "…",
    "conditionRequirements": {
      "unusedInOriginalPackaging": true,
      "includeTagsLabelsCertificates": true,
      "photographicProofRequired": false
    }
  }],
  "selectedPolicyId": "…",
  "selectedPolicy": { "id": "…", "description": "…" },  // ⚠ READ as a string, WRITTEN as an object — normalize
  "returnPolicy": "…",                                   // generated description text
  "acceptReturns": true                                  // ⚠ read into the form but NEVER written on submit
}
```

**(b) Dimensions — DUAL shape that can DIVERGE** (needs a normalization rule at migration)
```jsonc
{
  // item dimensions (Pricing panel ≥2 dims filled; ALSO written by Photos/AI panel from `sizes`)
  "dimensions": { "length": 0, "width": 0, "height": 0, "unit": "in" },  // numbers (parseFloat), unit default "in"
  "weight":     { "value": "12", "unit": "oz" },                          // ⚠ value is a STRING, unit default "oz"
  // Shippo parcel (Pricing panel, shippingType="custom", all 4 fields) — DIFFERENT source fields
  "parcelData": { "length": 0, "width": 0, "height": 0, "distanceUnit": "in",
                  "weight": 0, "massUnit": "oz" }                         // all numbers
}
```
`dimensions`/`weight` (from `product*` fields, also AI) and `parcelData` (from `package*` fields) come
from independent inputs, with mixed string/number types — they can hold different values. Pick a
canonical source (parcelData for Shippo) and reconcile on read.

**(c) Fixed-shipping sub-fields** (`shippingType === "fixed"`)
`normalShippingType`, `normalShippingPrice`, `normalShippingDuration`, `fastShippingType`,
`fastShippingPrice`, `fastShippingDuration`, plus `normalShippingDiscount` / `fastShippingDiscount`
(written independently as parseFloat when non-empty).

**(d) Listing-level addresses** (distinct from the user `Address` table)
`pickupLocation` ({street1,street2,city,state,zip,country,shippingAddressValid}), `pickupAddress` (a
flattened display string), `pickupAddressId`, `shippingAddress` (same object shape as pickupLocation),
`location` ({address, building} — written by `EditListingLocationPanel`). `sameAsShop` is referenced in
the gap list but was NOT found under that exact key in `src/` — verify before relying on it.

**(e) Booleans** `negotiablePrice`, `localTaxes` (both default false).

**(f) Provenance — ⚠ DUPLICATE-KEY landmine**
`sellerNote` (singular, written by `EditListingPhotosPanel`) **vs** `sellerNotes` (plural, written by
`EditListingDetailsPanel`); the AI generator (`ai-listing-generator.js`) writes BOTH to the same value
as a reconciliation hack. Migrate to ONE column and collapse both keys. Also `otherMaterial`,
`restoration` (bool), `restoration_status`, `restoration_details` (the last two written as `""` when
`restoration` is false; form fields are `pub_*`-prefixed but persisted UNprefixed).

**(g) AI precedence rule for the promoted `condition` column**
`aiGeneratedData` may carry `pricing.pub_condition` / `pricing.pub_authenticity` /
`pricing.pub_provenance` (server-side defaults "good" / "authentic" / "Private collection"). BUT the
editor only ever persists `aiGeneratedData.{details,history}` and reads only those two — the
`pricing/delivery/finalize` AI blob is dropped, and **no panel writes a top-level `condition`/
`authenticity`/`provenance`**. So today these AI suggestions are stranded. Migration decision: the
promoted `Listing.condition` column should be populated from the top-level value when present, falling
back to `aiGeneratedData.pricing.pub_condition` only if you decide to rescue the stranded AI value —
document the chosen precedence explicitly (recommended: top-level wins, AI is fallback).

---

## 5. Orders (the transaction engine)

Order state is **data-driven** (a process registry) so adding states/transitions needs no migration. Full engine semantics in doc 04.

```prisma
// --- Process registry (seed data, mirrors ext/transaction-processes/*.edn) ---
model ProcessDef {
  alias       String   @id            // "instant-purchase/release-14"
  name        OrderProcess
  definition  Json                    // states[], transitions[], timers[], actor rules
  active      Boolean  @default(true)
}

model Order {                          // == Sharetribe "transaction"
  id            String      @id @default(dbgenerated("uuidv7()")) @db.Uuid
  processAlias  String
  processName   OrderProcess
  state         String                 // current state name (e.g. "purchased")
  lastTransition String?
  lastTransitionedAt DateTime?

  customerId    String      @db.Uuid
  providerId    String      @db.Uuid
  listingId     String?     @db.Uuid   // null for pure cart-parent
  parentOrderId String?     @db.Uuid   // child/parent (cart) relationship
  customer      User        @relation("OrderCustomer", fields: [customerId], references: [id])
  provider      User        @relation("OrderProvider", fields: [providerId], references: [id])

  // Money snapshots (derived from line items, persisted for fast reads)
  payinTotalAmount  BigInt   @default(0)
  payoutTotalAmount BigInt   @default(0)
  currency      String       @db.Char(3)

  // Buyer/shipping context (was protectedData)
  shippingAddress Json?                 // {street, city, state, postal_code, country}
  cartSnapshot    Json?                 // cart contents at order time
  salesTaxSnapshot Json?                // {hasNexus, rate, amountToCollectCents, source}
  protectedData   Json     @default("{}")
  metadata        Json     @default("{}") // lastOperatorAction audit, etc.

  // Payout/escrow tracking — the irreversibility boundary (doc 04)
  payoutReleased  Boolean  @default(false)
  payoutReleasedAt DateTime?

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  lineItems     LineItem[]
  transitions   OrderTransition[]
  reservations  StockReservation[]
  messages      Message[]
  reviews       Review[]
  scheduled     ScheduledTransition[]
  paymentIntent PaymentIntent?
  payout        Payout?
  refunds       Refund[]

  @@index([customerId, state])
  @@index([providerId, state])
  @@index([listingId])
  @@index([state, lastTransitionedAt])
  @@index([parentOrderId])
}

model OrderTransition {                  // immutable audit log of every transition
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId     String   @db.Uuid
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  transition  String
  fromState   String?
  toState     String
  actor       String                     // customer | provider | operator | system
  actorUserId String?  @db.Uuid
  metadata    Json     @default("{}")
  createdAt   DateTime @default(now())
  @@index([orderId, createdAt])
}

model LineItem {
  id          String      @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId     String      @db.Uuid
  order       Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)
  code        LineItemCode
  unitPriceAmount BigInt
  currency    String      @db.Char(3)
  quantity    Int         @default(1)
  percentage  Decimal?    @db.Decimal(9,4)   // for commission lines
  lineTotalAmount BigInt
  includeFor  IncludeFor[]                    // [customer], [provider], or both
  reversal    Boolean     @default(false)     // refund reversal line
  @@index([orderId])
}

model StockReservation {                       // replaces cart-stock-process
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId     String?  @db.Uuid
  listingId   String   @db.Uuid
  variantId   String?  @db.Uuid
  quantity    Int
  state       String   // pending | confirmed | expired | canceled
  expiresAt   DateTime // 15-minute hold
  createdAt   DateTime @default(now())
  @@index([listingId, state])
  @@index([expiresAt, state])
}

model ScheduledTransition {                    // replaces Sharetribe time-based transitions (PT15M, P3D, P14D...)
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId     String   @db.Uuid
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  transition  String
  guardState  String                          // only fire if order still in this state
  runAt       DateTime
  status      String   @default("pending")    // pending | fired | skipped | canceled
  attempts    Int      @default(0)
  @@index([status, runAt])
}

model CartItem {                               // was currentUser.privateData.cart
  id         String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId     String  @db.Uuid
  user       User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  listingId  String  @db.Uuid
  variant    String?
  size       String?
  quantity   Int     @default(1)
  addedAt    DateTime @default(now())
  @@unique([userId, listingId, variant, size])
}

model Message {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId     String   @db.Uuid
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  senderId    String   @db.Uuid
  content     String
  createdAt   DateTime @default(now())
  @@index([orderId, createdAt])
}

model Review {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId     String   @db.Uuid
  listingId   String?  @db.Uuid
  authorId    String   @db.Uuid
  subjectId   String   @db.Uuid          // user being reviewed
  type        String                     // ofProvider | ofCustomer
  rating      Int                        // 1..5
  content     String?
  state       String   @default("public")// public | pending
  createdAt   DateTime @default(now())
  order       Order    @relation(fields: [orderId], references: [id])
  listing     Listing? @relation(fields: [listingId], references: [id])
  @@index([subjectId, state])
  @@index([listingId])
}
```

---

## 6. Payments (Stripe Connect)

```prisma
model StripeAccount {                          // seller Connect (Custom) account
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId          String   @unique @db.Uuid
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripeAccountId String   @unique
  country         String?
  status          StripeAcctStatus @default(none)
  chargesEnabled  Boolean  @default(false)
  payoutsEnabled  Boolean  @default(false)
  requirementsDue Json?                        // currently_due / past_due snapshot
  externalLast4   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model StripeCustomer {
  id               String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId           String  @unique @db.Uuid
  user             User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripeCustomerId String  @unique
  defaultPaymentMethodId String?
  paymentMethods   PaymentMethod[]
}

model PaymentMethod {
  id           String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  customerId   String   @db.Uuid
  customer     StripeCustomer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  stripePmId   String   @unique
  brand        String?
  last4        String?
  expMonth     Int?
  expYear      Int?
  createdAt    DateTime @default(now())
}

model PaymentIntent {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId       String   @unique @db.Uuid
  order         Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stripePiId    String   @unique
  clientSecret  String?
  amount        BigInt
  currency      String   @db.Char(3)
  applicationFeeAmount BigInt?              // = payin - payout (platform margin)
  status        String                      // requires_payment_method|requires_confirmation|requires_capture|succeeded|canceled
  capturedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Payout {                                // escrow release: platform balance → seller Connect
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId       String   @unique @db.Uuid
  order         Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stripeTransferId String? @unique
  destinationAccountId String
  amount        BigInt
  currency      String   @db.Char(3)
  status        String   // pending | paid | failed | reversed
  releasedAt    DateTime?
  createdAt     DateTime @default(now())
}

model Refund {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId       String   @db.Uuid
  order         Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stripeRefundId String? @unique
  mode          RefundMode
  resolution    RefundResolution
  amount        BigInt
  currency      String   @db.Char(3)
  reason        String?
  note          String?
  actor         String?                       // operator id / "system"
  createdAt     DateTime @default(now())
  @@index([orderId])
}

model StripeEvent {                            // webhook idempotency + audit
  id          String   @id                     // Stripe event id (evt_...)
  type        String
  payload     Json
  processedAt DateTime?
  createdAt   DateTime @default(now())
}
```

---

## 7. Tax & Shipping

```prisma
model TaxOrder {                               // TaxJar mirror (id "pastel-{orderId}")
  id          String   @id                     // pastel-{orderId}
  orderId     String   @unique @db.Uuid
  amount      BigInt
  shipping    BigInt
  salesTax    BigInt
  toState     String?
  reportedAt  DateTime?
  raw         Json
}

model TaxRefund {
  id          String   @id                     // pastel-refund-{orderId}-{suffix}
  orderId     String   @db.Uuid
  amount      BigInt
  salesTax    BigInt
  reportedAt  DateTime?
  raw         Json
  @@index([orderId])
}

model Shipment {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId       String   @db.Uuid
  carrier       String?
  service       String?
  shippoRateId  String?
  shippoTxId    String?
  labelUrl      String?
  rateAmount    BigInt?
  currency      String?  @db.Char(3)
  createdAt     DateTime @default(now())
  tracking      TrackingEntry[]
  @@index([orderId])
}

model TrackingEntry {                          // was Firestore orderTracking
  id           String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  orderId      String  @db.Uuid
  shipmentId   String? @db.Uuid
  shipment     Shipment? @relation(fields: [shipmentId], references: [id])
  trackingId   String
  trackingLink String?
  updatedById  String? @db.Uuid
  updatedAt    DateTime @updatedAt
  @@index([orderId])
}
```

---

## 8. Social

```prisma
model Follow {                                 // was Firestore follows
  followerId  String   @db.Uuid
  followingId String   @db.Uuid
  source      String?
  status      String   @default("active")      // always 'active' today (unfollow deletes the row);
                                                // field kept for forward-compat / index parity with
                                                // firestore.indexes.json (followerId+status, followingId+status)
  createdAt   DateTime @default(now())
  follower    User     @relation("Follower", fields: [followerId], references: [id], onDelete: Cascade)
  following   User     @relation("Following", fields: [followingId], references: [id], onDelete: Cascade)
  @@id([followerId, followingId])
  @@index([followingId, status])               // "who follows X" (status='active' filter)
  @@index([followerId, status])                // "who X follows" (status='active' filter)
}

model Favorite {                               // wishlist (was user publicData.favourites)
  userId     String  @db.Uuid
  listingId  String  @db.Uuid
  createdAt  DateTime @default(now())
  @@id([userId, listingId])
  @@index([listingId])
}

model Story {                                  // was Firestore stories; media in object storage
  id          String    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String    @db.Uuid
  listingId   String?   @db.Uuid
  storyType   String                          // public | highlight
  mediaType   MediaType
  mediaUrl    String
  thumbnailUrl String?
  description String?
  likeCount   Int       @default(0)
  showOnProductPage Boolean @default(false)
  createdAt   DateTime  @default(now())
  expiresAt   DateTime?                        // 24h for public stories
  @@index([userId, createdAt])
  @@index([listingId])
  @@index([expiresAt])                         // expiry sweep
}

model StoryLike {                              // was likes[] array inside the story doc
  storyId   String   @db.Uuid
  userId    String   @db.Uuid
  createdAt DateTime @default(now())
  @@id([storyId, userId])
}

model Highlight {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String   @db.Uuid
  name        String
  coverStoryId String? @db.Uuid
  createdAt   DateTime @default(now())
  stories     HighlightStory[]
  @@index([userId])
}

model HighlightStory {
  highlightId String  @db.Uuid
  storyId     String  @db.Uuid
  position    Int     @default(0)
  highlight   Highlight @relation(fields: [highlightId], references: [id], onDelete: Cascade)
  @@id([highlightId, storyId])
}
```

---

## 9. Notifications

```prisma
model Notification {                           // was Firestore notifications
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  recipientId   String   @db.Uuid
  type          String                         // ~30 types (order_*, message_*, follow, story_*, product_*, upcoming_live)
  recipientMode String?                         // buyer | seller
  actorId       String?  @db.Uuid
  actorName     String?
  actorImage    String?
  listingId     String?  @db.Uuid
  listingTitle  String?
  orderId       String?  @db.Uuid
  showId        String?  @db.Uuid
  storyId       String?  @db.Uuid
  messagePreview String?

  // Dedup. Today this is enforced two different ways in Firestore; both collapse to scheduledKey:
  //  - order-transition notifications dedup on (recipientId, orderId, type) via a check-before-create
  //    query (notifications.js notificationAlreadyExists). orderId is NULLABLE, so a plain @@unique
  //    over-constrains; enforce with a PARTIAL UNIQUE INDEX in SQL: UNIQUE(recipientId, orderId, type)
  //    WHERE order_id IS NOT NULL (see doc 05).
  //  - upcoming_live reminders use a deterministic Firestore doc id "upcoming_live_{showId}_{recipientId}"
  //    (merge-upsert). Represent that here as scheduledKey, which carries the dedup identity for the
  //    scheduled-notification class.
  scheduledKey  String?                         // deterministic dedup key e.g. "upcoming_live_{showId}_{recipientId}"
  sendAt        DateTime?                        // future-visible time for scheduled in-app notifications
                                                 // (upcoming_live = scheduledAt - 1h, clamped to >= now)

  read          Boolean  @default(false)
  readAt        DateTime?
  createdAt     DateTime @default(now())
  @@unique([scheduledKey])                      // upcoming_live merge-upsert identity (NULL for ad-hoc rows)
  @@index([recipientId, createdAt])
  @@index([recipientId, read])
  @@index([type, showId])                       // clearShowReminderNotifications: delete upcoming_live/live by showId on start/end
  @@index([sendAt])                             // scheduled-notification sweep (partial WHERE sendAt IS NOT NULL)
  // PARTIAL UNIQUE(recipientId, orderId, type) WHERE orderId IS NOT NULL — order-transition dedup (doc 05)
}

// NOTE: scheduled in-app notifications (currently only `upcoming_live`) reuse the same
// "schedule then cancel" pattern as OrderEmailReminder (§9): scheduled ~1h before the show on
// create/update (orchestrator-proxy.js), and CLEARED (deleted) on show start and on show end. The
// Notification.sendAt + scheduledKey fields above let the in-app sweep + dedup live on the row itself
// rather than in a separate reminder table.

model NotificationPreference {                 // was Firestore notificationPreferences
  userId     String  @id @db.Uuid
  priorities Json    @default("{}")            // {type -> low|default|high}
  enabled    Json    @default("{}")            // {buyer|seller -> {type -> bool}}
  updatedAt  DateTime @updatedAt
}

model PushToken {                              // was Firestore pushTokens
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String   @db.Uuid
  token       String                           // FCM token
  platform    String?                          // ios | android | web
  appVersion  String?
  bundleVersion String?
  revoked     Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([userId, token])
  @@index([userId, revoked])
}

model OrderEmailReminder {                     // was Firestore orderEmailReminders
  id            String   @id                    // {orderId}_{reminderType}
  orderId       String   @db.Uuid
  reminderType  String
  recipientId   String   @db.Uuid
  recipientMode String?
  sendAt        DateTime
  sent          Boolean  @default(false)
  canceled      Boolean  @default(false)
  @@index([sent, canceled, sendAt])
}
```

---

## 10. Live shows, Promotions, Config/CMS

```prisma
// --- Live shows (Postgres index; orchestrator is source of truth) ---
model Show {
  id            String   @id                    // orchestrator show id (= LiveKit room)
  creatorId     String   @db.Uuid
  title         String?
  status        ShowStatus @default(scheduled)
  scheduledAt   DateTime?
  startedAt     DateTime?                        // latest start (top-level, separate from per-session)
  endedAt       DateTime?                        // latest end (top-level)
  connectionState String?                        // connected | reconnecting | ended (livekit-webhook)
  sellerDisconnectedAt DateTime?
  graceEndsAt   DateTime?                        // grace-window sweeper (10 min in code)

  // Session tracking (Firestore embedded sessions[] → normalized to ShowSession rows)
  currentSessionId String?                       // = active session's sessionId; null when not live
  sessionCount  Int      @default(0)             // sessions.length
  totalDuration Int      @default(0)             // sum of completed sessions' duration (seconds)
  endReason     String?                          // manual | grace_expired | webhook (set in shows-end.js)
  lastSellerEventAt DateTime?                    // out-of-order webhook guard (livekit-webhook.js)

  pinnedProductId String? @db.Uuid
  productIds    String[]  @db.Uuid               // → Product.id array (live-show catalog, see §4 Product)
  createdAt     DateTime @default(now())
  sessions      ShowSession[]
  @@index([status, graceEndsAt])
  @@index([creatorId, status])
}

model ShowSession {                              // was Firestore shows.sessions[] embedded array
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  showId      String                             // → Show.id (orchestrator string id)
  show        Show     @relation(fields: [showId], references: [id], onDelete: Cascade)
  sessionId   String                             // generated string "session-{ts}-{rand}" (NOT a UUID); referenced by Show.currentSessionId
  startedAt   DateTime
  endedAt     DateTime?                          // null while active
  duration    Int?                               // seconds; null while active (durationFormatted is derived)
  status      String   @default("active")        // active | completed
  @@unique([showId, sessionId])
  @@index([showId])
}

// --- Promotions ---
model Discount {                                 // global promo codes
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  code        String   @unique
  isActive    Boolean  @default(true)
  percentage  Decimal  @db.Decimal(5,2)
  remainingUsage Int?
  showOn      String[]
  applyOn     String[]
  title       String?
  expiresAt   DateTime?
  usages      DiscountUsage[]
}

model DiscountUsage {                            // single-use guard: unique(userId, discountId)
  id            String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  discountId    String  @db.Uuid
  discount      Discount @relation(fields: [discountId], references: [id], onDelete: Cascade)
  userId        String  @db.Uuid
  orderId       String? @db.Uuid
  usedAt        DateTime @default(now())
  @@unique([userId, discountId])
}

model ShopPromotion {                            // per-seller promo
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  sellerId      String   @db.Uuid
  name          String
  code          String
  discountPercent Decimal @db.Decimal(5,2)
  isActive      Boolean  @default(true)
  usageLimit    Int?
  usageCount    Int      @default(0)
  revenue       BigInt   @default(0)
  discountGiven BigInt   @default(0)
  shares        Int      @default(0)
  expiresAt     DateTime?
  deletedAt     DateTime?
  usages        ShopPromotionUsage[]
  @@unique([sellerId, code])
  @@index([sellerId, isActive])
}

model ShopPromotionUsage {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  promotionId   String   @db.Uuid
  promotion     ShopPromotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  userId        String   @db.Uuid
  orderId       String?  @db.Uuid
  usedAt        DateTime @default(now())
  @@unique([userId, promotionId])
}

model CommissionConfig {                         // replaces hosted commission.json
  id                  Int      @id @default(1)
  providerPercentage  Decimal  @db.Decimal(5,2)
  customerPercentage  Decimal  @db.Decimal(5,2)
  updatedAt           DateTime @updatedAt
}

// --- Config / CMS (replaces Sharetribe hosted assets) ---
model ConfigAsset {                              // listing-types, listing-fields, user-types, search config, branding, translations...
  key         String   @id                       // "listings/listing-fields", "design/branding"
  version     String
  data        Json
  updatedAt   DateTime @updatedAt
}

model CmsPage {                                  // landing-page, terms, privacy, custom pages
  slug        String   @id
  data        Json
  publishedAt DateTime?
  updatedAt   DateTime @updatedAt
}
```

---

## 11. Media, Admin/Ops, Platform

```prisma
model MediaAsset {                               // object-storage record + variant metadata
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  ownerId     String?  @db.Uuid
  kind        String                             // listing-image | profile-image | story | appeal
  storageKey  String                             // S3 key
  contentType String?
  width       Int?
  height      Int?
  createdAt   DateTime @default(now())
}

// --- Admin / Ops / Compliance ---
model AuditLog {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  actor       String                             // operator id
  action      String
  entityType  String
  entityId    String?
  detail      Json     @default("{}")
  createdAt   DateTime @default(now())
  @@index([entityType, entityId])
  @@index([createdAt])
}

model RestrictionAppeal {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String   @db.Uuid
  email       String?
  subject     String?
  description String?
  attachmentUrl String?
  userType    String?
  restrictionReason String?
  status      String   @default("pending")
  adminNote   String?
  adminActor  String?
  reviewedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Per-user restriction HISTORY (was Firestore `user_restrictions`, admin-users.js +
// restriction-appeals.js). Shown as `restrictionHistory` in the appeal flow (getUser, most-recent 20).
// Typed here rather than relying on generic AuditLog because it has a fixed query shape and powers a
// user-facing surface. Most fields are optional (each `action` writes a different subset). AuditLog
// remains for other one-off operator actions; this table is purpose-built for restriction lifecycle.
model UserRestriction {
  id                  String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId              String   @db.Uuid
  action              String                  // restrict | unrestrict | change-type | reset-profile | delete | restore | appeal-submitted | complete-account-deletion-*
  reason              String
  userType            String   @default("customer")  // provider | customer
  closedListings      Int?                    // written by restrict/reset-profile/delete/complete-*
  revokedWaitlistCount Int?                   // written by change-type/reset-profile
  adminNote           String?
  adminActor          String                  // admin id, or appellant email for appeal-submitted
  createdAt           DateTime @default(now())
  @@index([userId, createdAt])
}

model ContentReport {
  id           String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  contentType  String
  contentId    String
  reason       String
  isDmca       Boolean  @default(false)
  details      String?
  reporterEmail String?
  reporterUserId String? @db.Uuid
  status       String   @default("open")
  createdAt    DateTime @default(now())
}

model AccountDeletionRequest {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String?  @db.Uuid
  email       String
  userType    String?
  status      String   @default("pending")       // pending | completed
  resolution  String?
  requestedAt DateTime @default(now())
  completedAt DateTime?
}

model Waitlist {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  email         String   @unique
  name          String?
  phone         String?
  role          String?
  status        String   @default("pending_verification")
  priority      Int      @default(0)
  referralToken String?  @unique
  referredById  String?  @db.Uuid
  referralCount Int      @default(0)
  userId        String?  @db.Uuid
  createdAt     DateTime @default(now())
}

model AnalyticsDaily {                            // was Firestore pastelAnalytics (1 doc/day)
  day             String  @id                     // YYYY-MM-DD
  pageViews       BigInt  @default(0)
  uniqueSessions  BigInt  @default(0)
  signups         BigInt  @default(0)
  emailVerifications BigInt @default(0)
  cartAdds        BigInt  @default(0)
  checkoutStarts  BigInt  @default(0)
  paymentStepViews BigInt @default(0)
  reviewStepViews BigInt  @default(0)
  checkoutCompletes BigInt @default(0)
  shopVisits      Json    @default("{}")          // {handle -> n}
  referrals       Json    @default("{}")          // {source -> n}
}

// --- Platform shared ---
model Outbox {
  id          String       @id @default(dbgenerated("uuidv7()")) @db.Uuid
  topic       String                              // order.transitioned, listing.published, notification.created...
  payload     Json
  status      OutboxStatus @default(pending)
  attempts    Int          @default(0)
  createdAt   DateTime     @default(now())
  sentAt      DateTime?
  @@index([status, createdAt])
}

model IdempotencyKey {
  key         String   @id
  scope       String                              // e.g. "checkout", "refund"
  response    Json?
  statusCode  Int?
  createdAt   DateTime @default(now())
  @@index([createdAt])
}

// Native client diagnostics (was Firestore `nativeLogs`, server/api/native-log.js). Unauthenticated
// write (always 204); token-gated tail reader (X-Native-Log-Token vs NATIVE_LOG_READ_TOKEN env).
// 7-day TTL: in Firestore a console TTL policy on `expiresAt` did the sweep — in Postgres this needs an
// explicit sweep job (delete WHERE expiresAt < now()), OR route these to a log pipeline and drop the
// table. `data` is size-clamped (2 KB) at write time.
model NativeLog {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  level       String   @default("info")           // clamped 16 chars
  event       String   @default("unknown")        // clamped 128 chars
  data        Json     @default("{}")             // jsonb; clamped 2 KB, may carry {_truncated} / {_unserialisable}
  ua          String?                             // user-agent, clamped 256 chars
  origin      String?                             // origin/referer header
  createdAt   DateTime @default(now())
  expiresAt   DateTime                            // createdAt + 7d; needs a sweep job (no console TTL in Postgres)
  @@index([createdAt])
}

// Per-device OTA bundle adoption (was Firestore `deviceBundles`, server/api/device-bundle.js).
// Unauthenticated upsert keyed by client-generated deviceId (== @id, merge upsert). firstSeenAt set once;
// lastSeenAt bumped every report. NOTE: committedAt is a STRING in source (orchestrator commit ref/time),
// not a timestamp — kept as String here to avoid a lossy coercion.
model DeviceBundle {
  deviceId      String   @id                       // client-generated, sanitized [A-Za-z0-9_-], >=8 chars
  bundleVersion String   @default("unknown")
  bundleLabel   String   @default("")
  release       String   @default("")
  committedAt   String   @default("")              // string, NOT a timestamp
  platform      String                             // ios | android
  appVersion    String   @default("")
  buildNumber   String   @default("")
  userId        String?  @db.Uuid                  // best-effort server resolution; null when unresolved
  firstSeenAt   DateTime @default(now())           // set once on create
  lastSeenAt    DateTime @updatedAt                // bumped every report
  @@index([bundleVersion])
  @@index([userId])
}
```

---

## 12. Indexing summary (write here; tuned in doc 05)

| Table | Critical indexes |
|---|---|
| `Listing` | `(state, createdAt)`, `(state, priceAmount)`, `(categoryL1,L2,L3)`, `(authorId,state)`, `GIN(materials)`, `GIN(to_tsvector(title‖description))`, `GiST(geo)`, `gin_trgm_ops(title)` |
| `Order` | `(customerId,state)`, `(providerId,state)`, `(state,lastTransitionedAt)`, `(parentOrderId)` |
| `ScheduledTransition` | `(status, runAt)` partial WHERE status='pending' |
| `StockReservation` | `(expiresAt, state)` partial WHERE state='pending' |
| `Notification` | `(recipientId, createdAt)`, `(recipientId, read)` partial WHERE read=false, `(type, showId)`, `(sendAt)` partial WHERE sendAt IS NOT NULL, `@@unique(scheduledKey)` + partial `UNIQUE(recipientId, orderId, type) WHERE orderId IS NOT NULL` (dedup) |
| `Follow` | `(followingId, status)`, `(followerId, status)` |
| `ShowSession` | `@@unique([showId, sessionId])`, `(showId)` |
| `Story` | `(userId, createdAt)`, `(expiresAt)` partial WHERE expiresAt IS NOT NULL |
| `NativeLog` | `(createdAt)` — plus a sweep job on `expiresAt` (no console TTL in Postgres) |
| `Outbox` | `(status, createdAt)` partial WHERE status='pending' |
| `DiscountUsage` / `ShopPromotionUsage` | `@@unique([userId, discountId])` — the single-use guard (replaces Firestore `{userId}-{code}` doc id) |

---

## 13. Mapping cheat-sheet (old → new)

| Sharetribe / Firebase | New table |
|---|---|
| user + profile + extended data | `User` (+ `UserPermission`, `Address`, `IdpLink`) |
| `effectivePermissionSet` | `UserPermission` |
| listing + ownListing + currentStock | `Listing` (+ `ListingImage/Media/Variant/Stats`) |
| Firestore `products` (live-show catalog) | `Product` (or fold into `Listing` — decide) |
| transaction + lineItems + transitions | `Order` + `LineItem` + `OrderTransition` |
| booking / availabilityException (dormant) | not modeled v1 (add `Booking`/`AvailabilityException` if revived) |
| message / review | `Message` / `Review` |
| stripeAccount / stripeCustomer / paymentMethod | `StripeAccount` / `StripeCustomer` / `PaymentMethod` |
| cart-stock-process reservation | `StockReservation` |
| user `privateData.cart` | `CartItem` |
| Firestore `follows` | `Follow` |
| Firestore `stories` / `highlights` / `storyLikes` | `Story` / `Highlight` (+`HighlightStory`) / `StoryLike` |
| Firestore `notifications` / `notificationPreferences` / `pushTokens` | `Notification` / `NotificationPreference` / `PushToken` |
| Firestore `discounts` / `discountUsages` / `shopPromotions*` | `Discount` / `DiscountUsage` / `ShopPromotion*` |
| Firestore `shows` (+ embedded `sessions[]`) | `Show` + `ShowSession` |
| Firestore `orderTracking` | `TrackingEntry` |
| Firestore `pastelAnalytics` | `AnalyticsDaily` |
| Firestore `waitlist` / `content_reports` / `restriction_appeals` / `account_deletion_requests` | `Waitlist` / `ContentReport` / `RestrictionAppeal` / `AccountDeletionRequest` |
| Firestore `user_restrictions` (restriction history) | `UserRestriction` (AuditLog remains for other operator actions) |
| Firestore `nativeLogs` | `NativeLog` |
| Firestore `deviceBundles` | `DeviceBundle` |
| hosted `commission.json` | `CommissionConfig` |
| hosted listing/search/user/branding assets, CMS | `ConfigAsset` / `CmsPage` |
| Sharetribe images + Firebase video URLs | `MediaAsset` + `ListingImage`/`ListingMedia`/`Story.mediaUrl` |

The behavioral semantics behind these tables — especially the order FSM, pricing, and Stripe flows — are specified in doc 04. What each must *do* (functional requirements) is in doc 03.
