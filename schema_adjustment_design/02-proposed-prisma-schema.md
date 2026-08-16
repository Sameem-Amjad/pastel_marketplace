# 02 — Proposed Prisma Schema (for review)

| | |
|---|---|
| **Derived from** | [`01-normalized-field-catalog.md`](./01-normalized-field-catalog.md) applied to [`prisma/schema.prisma`](../prisma/schema.prisma) |
| **Purpose** | Full proposed schema in reviewable form — **verify before** copying into `prisma/schema.prisma` |
| **Result** | 66 existing models → **88 models** (22 new), ~70 new columns, 5 breaking changes |
| **Status** | Draft v1 — not yet applied |
| **Validated** | ✅ every `prisma` block below was extracted and passed `npx prisma validate` (88 models, 42 enums) |

---

## 0. How to review this

Each section shows the **complete** Prisma block for that domain, so you can read it as the real
schema rather than as a diff. Change markers sit in the comments:

| Marker | Meaning |
|---|---|
| `// 🆕` | New model — does not exist today |
| `// ➕` | New field on an existing model |
| `// 🔄` | Existing field, changed type or semantics |
| `// ⚠️` | Breaking — needs a backfill job, not just `prisma migrate dev` |
| *(no marker)* | Unchanged from the current schema |

**Two things Prisma cannot express** — partial unique indexes and `CHECK` constraints. Every one of
them is in [§14](#14-raw-sql-companion), and they are not optional decoration: several are the only
thing standing between you and a duplicate-charge or double-thread bug. They ship as raw SQL in the
migration.

**One convention preserved deliberately.** The current schema references `User` by plain
`@db.Uuid` column without a Prisma relation in ~35 places (`Story.userId`, `Review.authorId`,
`Message.senderId`, `Notification.recipientId`, …). New models follow that same convention so this
stays a reviewable diff. That convention has a real cost — see [§15](#15-decision-needed-referential-integrity)
before signing off.

---

## 1. Datasource & generator

Unchanged.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [postgis, pg_trgm, btree_gin]
}
```

---

## 2. Enums

15 existing (1 changed) + 27 new = 42.

```prisma
// ── Existing ────────────────────────────────────────────────────────────────

enum UserType {
  customer
  seller
  provider
  admin // ➕ ⚠️ no admin identity exists today; every userType guard must be re-audited
}

enum AccountStatus {
  active
  restricted
  banned
  deleted
}

enum ListingState {
  draft
  pendingApproval
  published
  closed
}

enum StockType {
  oneItem
  multipleItems
  infiniteOneItem
  infiniteMultipleItems
}

enum DeliveryMethod {
  shipping
  pickup
  both
}

enum OrderProcess {
  instant_purchase
  default_purchase
  cart_stock
  inquiry
  booking
}

enum LineItemCode {
  item
  shipping_fee
  pickup_fee
  shipping_discount
  sales_tax
  app_promo_discount
  provider_commission
  customer_commission
}

enum IncludeFor {
  customer
  provider
}

enum StripeAcctStatus {
  none
  onboarding
  restricted
  enabled
}

enum RefundMode {
  full
  partial
}

enum RefundResolution {
  refund
  release
  replacement
}

enum NotificationChannelPriority {
  low
  default
  high
}

enum ShowStatus {
  scheduled
  live
  ended
}

enum MediaType {
  image
  video
}

enum OutboxStatus {
  pending
  sent
  failed
}

// ── 🆕 Address & shop ───────────────────────────────────────────────────────

enum AddressType {
  shipping
  billing
  shop
  shipFrom
  returnTo
}

enum ShopVisibility {
  public
  hidden
}

// ── 🆕 Catalog & shipping ───────────────────────────────────────────────────

enum ShippingMethod {
  free
  flat
  calculated
  custom
  localPickup
}

enum ShippingTier {
  standard
  express
  pickup
}

enum DimensionUnit {
  inch // "in" avoided — reserved-word risk in generated SQL/clients
  cm
}

enum WeightUnit {
  oz
  lb
  g
  kg
}

enum CollectionType {
  seller
  buyerSaved
}

enum ModerationStatus {
  notReviewed
  approved
  rejected
  flagged
}

enum ReturnShippingPayer {
  buyer
  seller
}

// ── 🆕 Orders & disputes ────────────────────────────────────────────────────

enum OrderStatusBucket {
  pendingPayment
  preparingShipment
  inTransit
  delivered
  pendingReview
  completed
  disputed
  refundOffered
  partiallyRefunded
  refunded
  disputeEscalated
  disputeResolved
  canceled
}

enum RefundStatus {
  none
  requested
  partial
  full
}

enum DisputeStatus {
  open
  underReview
  offerMade
  escalated
  resolved
  withdrawn
}

enum DisputeResolution {
  fullRefund
  partialRefund
  replacement
  released
}

// ── 🆕 Seller lifecycle ─────────────────────────────────────────────────────

enum SellerApplicationStatus {
  submitted
  waitlisted
  underReview
  approved
  rejected
  withdrawn
}

enum InviteStatus {
  notInvited
  invited
  accepted
  expired
}

// ── 🆕 Messaging & social ───────────────────────────────────────────────────

enum ConversationKind {
  product
  order
}

enum MessageKind {
  text
  image
  system
}

enum StoryStatus {
  draft
  posted
  expired
  archived
}

enum ShowStartMode {
  now
  scheduled
}

// ── 🆕 Money ────────────────────────────────────────────────────────────────

enum PaymentMethodType {
  card
  applePay
  googlePay
  link
}

enum LedgerEntryType {
  sale
  platformFee
  salesTax
  refund
  payout
  adjustment
}

enum LedgerDirection {
  credit
  debit
}

enum DiscountType {
  percentage
  fixedAmount
}

// ── 🆕 Notifications & admin ────────────────────────────────────────────────

enum RecipientMode {
  buyer
  seller
}

enum NotificationChannel {
  push
  email
  inApp
}

enum NotificationCategory {
  order
  message
  social
  live
  promotion
  dispute
  system
}

enum AdminRole {
  superAdmin
  opsAgent
  moderator
  financeAgent
  support
}
```

---

## 3. Identity & Auth

**Changes:** `User` +7 fields · `Address` +3 fields, +2 indexes · `SearchHistory` new.
`UserPermission`, `IdpLink`, `Credential`, `EmailToken` unchanged.

```prisma
model User {
  id                String        @id @default(uuid(7)) @db.Uuid
  email             String        @unique
  emailVerified     Boolean       @default(false)
  pendingEmail      String?
  passwordHash      String? // null for IdP-only accounts (Argon2id)
  userType          UserType      @default(customer)
  accountStatus     AccountStatus @default(active)
  restrictedAt      DateTime?
  restrictionReason String?

  // Profile
  firstName      String?
  lastName       String?
  displayName    String?
  bio            String?
  handle         String? @unique
  businessName   String?
  businessType   String?
  aboutShop      String?
  profileImageId String? @db.Uuid
  isTopSeller    Boolean @default(false)

  // ➕ Contact — "Phone number" (Account Settings, Manage Addresses)
  phone           String?
  phoneVerifiedAt DateTime?

  // ➕ Legal acceptance — "Terms & Privacy Agreement" (Create Account).
  //    Version, not a boolean: a bare flag is worthless the day the terms change.
  termsAcceptedAt   DateTime?
  termsVersion      String?
  privacyAcceptedAt DateTime?
  privacyVersion    String?

  // ➕ Activity — throttled write (≤1/hour), never on every request
  lastSeenAt DateTime?

  // Extended buckets (Sharetribe long tail)
  publicData    Json @default("{}")
  privateData   Json @default("{}")
  protectedData Json @default("{}")
  metadata      Json @default("{}")

  // Denormalized counters — maintained by the owning service, never client-writable
  followersCount Int @default(0)
  followingCount Int @default(0)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  // relations
  profileImage     MediaAsset?     @relation("UserProfileImage", fields: [profileImageId], references: [id])
  listings         Listing[]
  idpLinks         IdpLink[]
  permissions      UserPermission?
  addresses        Address[]
  stripeAccount    StripeAccount?
  stripeCustomer   StripeCustomer?
  collections      Collection[]
  cart             CartItem[]
  ordersAsCustomer Order[]         @relation("OrderCustomer")
  ordersAsProvider Order[]         @relation("OrderProvider")
  followsInitiated Follow[]        @relation("Follower")
  followsReceived  Follow[]        @relation("Following")

  // ➕ new 1:1 relations
  sellerProfile    SellerProfile?
  sellerOnboarding SellerOnboarding?
  sellerStats      SellerStats?
  sellerBalance    SellerBalance?
  adminMembership  AdminMembership?

  // ➕ new 1:N relations (required back-relations for the policy models)
  shippingPolicies ShippingPolicy[]
  returnPolicies   ReturnPolicy[]

  @@index([handle])
  @@index([userType, accountStatus])
  @@index([isTopSeller])
  @@index([phone]) // ➕ login-by-phone / support lookup
}

model UserPermission {
  userId       String   @id @db.Uuid
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  postListings String   @default("permission/allow")
  initiateTx   String   @default("permission/allow")
  read         String   @default("permission/allow")
  updatedAt    DateTime @updatedAt
}

model IdpLink {
  id          String   @id @default(uuid(7)) @db.Uuid
  userId      String   @db.Uuid
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider    String // google | apple | facebook
  providerUid String
  createdAt   DateTime @default(now())

  @@unique([provider, providerUid])
}

model Credential {
  id          String    @id @default(uuid(7)) @db.Uuid
  userId      String    @db.Uuid
  refreshHash String
  scope       String    @default("user")
  family      String?   @db.Uuid
  userAgent   String?
  ip          String?
  expiresAt   DateTime // "Keep me signed in" widens this TTL — it is NOT a column
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  @@index([userId])
  @@index([family])
}

model EmailToken {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String?   @db.Uuid
  email     String
  kind      String // verify_email | reset_password | buyer_verification
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([email, kind])
}

model Address {
  id         String      @id @default(uuid(7)) @db.Uuid
  userId     String      @db.Uuid
  user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       AddressType @default(shipping) // ➕ shipping | billing | shop | shipFrom | returnTo
  label      String?
  recipient  String?
  street1    String
  street2    String? // "Apt/Suite"
  city       String
  state      String?
  postalCode String?
  country    String
  phone      String? // ➕ carriers require a phone on the label
  isDefault  Boolean     @default(false)
  createdAt  DateTime    @default(now()) // ➕
  updatedAt  DateTime    @updatedAt // ➕
  deletedAt  DateTime? // ➕ soft delete — orders snapshot the address, so removal is safe

  @@index([userId])
  @@index([userId, type, isDefault]) // ➕
  // PARTIAL UNIQUE(userId, type) WHERE isDefault AND deletedAt IS NULL → §14
}

// 🆕 "Recent searches" (Empty Search Screen)
model SearchHistory {
  id          String   @id @default(uuid(7)) @db.Uuid
  userId      String   @db.Uuid
  query       String // trimmed, lowercased, ≤120 chars
  resultCount Int? // feeds "No results" analytics
  createdAt   DateTime @default(now())

  @@unique([userId, query]) // re-searching bumps createdAt via upsert — never duplicates
  @@index([userId, createdAt(sort: Desc)])
}
```

> **Retention:** keep the newest 20 `SearchHistory` rows per user; a nightly sweep trims the tail.
> Unbounded per-user history is a slow leak that nobody notices until it is 40 GB.

---

## 4. Seller identity

All five models are new. Together they cover Shop Settings (22 fields), Business Information,
the Seller Setup Guide, and the Become-a-Seller flow.

```prisma
// 🆕 1:1 with User. Everything on "Shop Settings" / "Business Information" that does not
//    belong on the generic user record. Kept separate so the auth-path User row stays narrow
//    and shop uniqueness (shopName, slug) gets its own constraints.
model SellerProfile {
  userId String @id @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  shopName   String  @unique
  slug       String  @unique // web SEO route: /shop/{slug}
  shopLogoId String? @db.Uuid // "shopPhoto" / "Shop logo" → MediaAsset

  showNameOnShop      Boolean @default(true) // show the seller's real first/last name
  about               String? // "aboutShop" / "about"
  businessType        String?
  businessDescription String?

  website     String?
  socialLinks Json    @default("{}") // { instagram, tiktok, x, ... }
  shopEmail   String? // public contact — distinct from User.email (the login)
  shopPhone   String?

  shopAddressId String? @db.Uuid // → Address(type: shop)

  visibility ShopVisibility @default(public)

  // Defaults inherited by every new listing
  defaultHandlingTimeDays Int     @default(2) // "orderHandlingTime"
  defaultShippingPolicyId String? @db.Uuid
  defaultReturnPolicyId   String? @db.Uuid

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([visibility])
}

// 🆕 "Seller Setup Guide" checklist. Timestamps, not booleans — "when did they finish
//    onboarding" is a question ops will ask, and a boolean cannot answer it.
model SellerOnboarding {
  userId String @id @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  businessInfoCompletedAt DateTime?
  policiesCompletedAt     DateTime?
  payoutSetupCompletedAt  DateTime? // mirrors StripeAccount.payoutsEnabled
  firstListingCreatedAt   DateTime?
  completedAt             DateTime? // set when all four are non-null

  updatedAt DateTime @updatedAt
}

// 🆕 "Become a Seller" form → waitlist → approval. The existing Waitlist model is an
//    email-capture list; this is the reviewable application. Both are kept, linked.
model SellerApplication {
  id          String  @id @default(uuid(7)) @db.Uuid
  userId      String? @db.Uuid // null when applied before signup
  waitlistId  String? @db.Uuid
  fullName    String
  email       String
  addressId   String? @db.Uuid

  sellerType         String // vocabulary from ConfigAsset
  sellingPlatforms   String[] // multi-select
  collectionSize     String? // banded: "1-10" | "11-50" | ...
  websiteOrSocialUrl String?
  biggestChallenge   String? // free text

  status   SellerApplicationStatus @default(submitted)
  priority Int                     @default(0) // drives "Queue position"

  onboardingBatch String?
  inviteStatus    InviteStatus @default(notInvited)
  invitedAt       DateTime?
  approvedAt      DateTime? // "Approval date"
  rejectedAt      DateTime?

  reviewedByUserId String? @db.Uuid
  decisionNote     String? // internal — never returned to the applicant

  submittedAt DateTime  @default(now())
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  @@index([status, priority, submittedAt]) // the queue + the "Queue position" rank
  @@index([userId])
  // PARTIAL UNIQUE(email) WHERE status NOT IN ('rejected','withdrawn') → §14
}

// 🆕 Backs sellerRating, ratingDistribution, productCount, totalSales, sellerRank.
//    System-written only.
model SellerStats {
  userId String @id @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  listingCount Int @default(0) // published only
  orderCount   Int @default(0) // completed only

  grossSalesAmount BigInt @default(0) // "totalSales"
  currency         String @default("USD") @db.Char(3)

  ratingAvg   Float @default(0)
  reviewCount Int   @default(0)
  rating1     Int   @default(0) // the "ratingDistribution" histogram
  rating2     Int   @default(0)
  rating3     Int   @default(0)
  rating4     Int   @default(0)
  rating5     Int   @default(0)

  rank Int? // "sellerRank" — formula undefined, see 01 §9.7

  updatedAt DateTime @updatedAt

  @@index([rank])
  @@index([ratingAvg])
}

// 🆕 GDPR/CCPA consent for the web surface
model ConsentRecord {
  id        String   @id @default(uuid(7)) @db.Uuid
  userId    String?  @db.Uuid // null for pre-login consent
  sessionId String? // anonymous visitor
  purpose   String // necessary | analytics | marketing
  granted   Boolean
  policyVersion String
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())

  @@index([userId, purpose, createdAt])
  @@index([sessionId])
}
```

---

## 5. Policies

Both new. `shippingPolicyId` / `returnPolicyId` / `returnWindow` are referenced across 9 screens
and have no home today.

```prisma
// 🆕 Reusable, seller-owned shipping policy
model ShippingPolicy {
  id       String @id @default(uuid(7)) @db.Uuid
  sellerId String @db.Uuid
  seller   User   @relation(fields: [sellerId], references: [id], onDelete: Cascade)

  name               String // "Standard domestic"
  handlingTimeDays   Int    @default(2)
  shipsFromAddressId String? @db.Uuid // → Address(type: shipFrom)
  shipsToCountries   String[] // ISO-3166-1 alpha-2

  isDefault Boolean   @default(false)
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime? // soft delete — listings reference it

  listings Listing[] @relation("ListingShippingPolicy")

  @@unique([sellerId, name])
  @@index([sellerId, isActive])
  // PARTIAL UNIQUE(sellerId) WHERE isDefault AND deletedAt IS NULL → §14
  // CHECK (handlingTimeDays BETWEEN 0 AND 30)                      → §14
}

// 🆕 "Return & Exchange Policy Modal"
model ReturnPolicy {
  id       String @id @default(uuid(7)) @db.Uuid
  sellerId String @db.Uuid
  seller   User   @relation(fields: [sellerId], references: [id], onDelete: Cascade)

  name                 String // "Policy name"
  acceptsReturns       Boolean             @default(true)
  returnWindowDays     Int? // "Return period" — null only when acceptsReturns = false
  exchangeAccepted     Boolean             @default(false)
  returnShippingPaidBy ReturnShippingPayer @default(buyer) // "buyerPaysReturnShipping"
  conditions           String? // "Return conditions"

  isDefault Boolean   @default(false)
  isActive  Boolean   @default(true) // "Policy status"
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  listings Listing[] @relation("ListingReturnPolicy")

  @@unique([sellerId, name])
  @@index([sellerId, isActive])
  // PARTIAL UNIQUE(sellerId) WHERE isDefault AND deletedAt IS NULL      → §14
  // CHECK (NOT acceptsReturns OR returnWindowDays IS NOT NULL)          → §14
}
```

> **Snapshot rule.** A policy is *referenced* by a listing but **copied** onto the order at purchase
> (`Order.returnPolicySnapshot`). Editing a policy must never retroactively change terms a buyer
> already agreed to — same reasoning as `Order.shippingAddress` being a JSON snapshot today.

---

## 6. Catalog

**Changes:** `Listing` +22 fields, −4 (⚠️) · `ListingShippingOption` new ·
`Collection` +7 fields. `Category`, `ListingImage`, `ListingMedia`, `ListingVariant`,
`ListingStats`, `CollectionListing` unchanged.

```prisma
model Category {
  id        String     @id
  name      String
  parentId  String?
  parent    Category?  @relation("CatTree", fields: [parentId], references: [id])
  children  Category[] @relation("CatTree")
  level     Int
  path      String
  sortOrder Int        @default(0)
  active    Boolean    @default(true)

  @@index([parentId])
  @@index([path])
}

model Listing {
  id          String       @id @default(uuid(7)) @db.Uuid
  authorId    String       @db.Uuid
  author      User         @relation(fields: [authorId], references: [id])
  title       String       @default("Draft")
  slug        String?      @unique // ➕ web SEO route: /listing/{slug}
  description String?
  sellerNote  String? // ➕ "sellerNote" (Add Product Details) — ≤1000 chars
  state       ListingState @default(draft)

  // Money
  priceAmount         BigInt?
  priceCurrency       String? @db.Char(3)
  originalPriceAmount BigInt? // strike-through source for "Product discount"
  costAmount          BigInt?

  // Type / process
  listingType  String @default("instant-purchase")
  processAlias String @default("instant-purchase/release-14")
  unitType     String @default("item")

  // Categories (denormalized ancestors → equality-indexable filters)
  categoryL1    String?
  categoryL2    String?
  categoryL3    String?
  otherCategory String?

  // Stock
  stockType     StockType @default(multipleItems)
  stockQuantity Int       @default(0)
  stockVersion  Int       @default(0) // optimistic lock

  // Delivery
  deliveryMethod  DeliveryMethod @default(shipping)
  shippingEnabled Boolean        @default(true)
  pickupEnabled   Boolean        @default(false)

  // 🔄 ⚠️ shippingType / shipOneItemAmount / shipAddlItemAmount / freeShipping REMOVED —
  //        superseded by ListingShippingOption (standard + express tiers, per-tier transit).
  //        Backfill one `standard` row per listing before dropping the columns.
  shippingMethod   ShippingMethod @default(flat) // ➕
  handlingTimeDays Int? // ➕ falls back to SellerProfile.defaultHandlingTimeDays

  shipFromAddressId String? @db.Uuid // ➕ "sellerAddress" / "shippingOrigin"
  shippingPolicyId  String? @db.Uuid // ➕
  returnPolicyId    String? @db.Uuid // ➕

  // Geo (PostGIS) — optional
  geo Unsupported("geography(Point,4326)")?

  // Provenance / descriptive
  condition String?
  period    String? // "era" / "ageEra"
  origin    String?
  materials String[] // multi-enum has_all/has_any via GIN

  // ➕ 🔄 ⚠️ replaces `certification String?` — backfill by inspecting URL vs asset key
  certificationAssetId String? @db.Uuid // "certificationPhoto"
  certificationUrl     String? // "certificationUrl"

  // ➕ Item dimensions (Add Product Details) — shown to the buyer
  itemLength        Decimal?       @db.Decimal(10, 2)
  itemWidth         Decimal?       @db.Decimal(10, 2)
  itemHeight        Decimal?       @db.Decimal(10, 2)
  itemDimensionUnit DimensionUnit?
  itemWeight        Decimal?       @db.Decimal(10, 3)
  itemWeightUnit    WeightUnit?

  // ➕ Package dimensions (Pricing & Shipping) — REQUIRED to buy a Shippo rate.
  //    Deliberately separate from item dimensions: a 2cm ring ships in a 15cm box.
  packageLength        Decimal?       @db.Decimal(10, 2)
  packageWidth         Decimal?       @db.Decimal(10, 2)
  packageHeight        Decimal?       @db.Decimal(10, 2)
  packageDimensionUnit DimensionUnit?
  packageWeight        Decimal?       @db.Decimal(10, 3)
  packageWeightUnit    WeightUnit?

  // ➕ Cover image — "coverImage" is a distinct field from the image list on every add-product screen
  coverImageId String? @db.Uuid

  // ➕ Moderation (admin)
  moderationStatus ModerationStatus @default(notReviewed)
  moderationReason String? // shown to the seller on rejection
  reviewedByUserId String?          @db.Uuid
  reviewedAt       DateTime?

  // The long tail
  publicData  Json @default("{}")
  privateData Json @default("{}")
  metadata    Json @default("{}")

  // AI generation
  aiGeneratedData Json?
  aiDataGenerated Boolean @default(false)

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  publishedAt DateTime?
  deletedAt   DateTime?

  images          ListingImage[]
  media           ListingMedia[]
  variants        ListingVariant[]
  reviews         Review[]
  stats           ListingStats?
  collections     CollectionListing[]
  shippingOptions ListingShippingOption[] // ➕
  shippingPolicy  ShippingPolicy?         @relation("ListingShippingPolicy", fields: [shippingPolicyId], references: [id])
  returnPolicy    ReturnPolicy?           @relation("ListingReturnPolicy", fields: [returnPolicyId], references: [id])

  @@index([authorId, state])
  @@index([authorId, deletedAt, createdAt])
  @@index([state, createdAt])
  @@index([state, priceAmount])
  @@index([categoryL1, categoryL2, categoryL3])
  @@index([listingType])
  @@index([shippingPolicyId]) // ➕
  @@index([returnPolicyId]) // ➕
  @@index([moderationStatus, createdAt]) // ➕ admin moderation queue
  // GIN(materials), GIN(fts), GiST(geo), trigram(title) → prisma/sql/performance.sql
}

// 🆕 The only shape that supports the design's standard AND express tiers with
//    per-tier transit times. Replaces four flat columns on Listing.
model ListingShippingOption {
  id        String  @id @default(uuid(7)) @db.Uuid
  listingId String  @db.Uuid
  listing   Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)

  tier     ShippingTier
  priceAmount BigInt    @default(0) // 0 = free shipping
  currency String       @db.Char(3)

  // "shippingDiscountPerItem" / "discountPerExtraItem" — signed; negative = discount
  extraItemAdjustmentAmount BigInt @default(0)

  // "carrierTransitTime" appears twice per screen: it is the min/max pair
  // rendered as "3–5 business days"
  transitMinDays Int?
  transitMaxDays Int?

  isActive Boolean @default(true)

  @@unique([listingId, tier])
  @@index([listingId, isActive])
  // CHECK (transitMinDays IS NULL OR transitMaxDays >= transitMinDays) → §14
}

model ListingImage {
  id        String  @id @default(uuid(7)) @db.Uuid
  listingId String  @db.Uuid
  listing   Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
  assetId   String  @db.Uuid
  position  Int     @default(0)

  @@index([listingId, position])
}

model ListingMedia {
  id           String    @id @default(uuid(7)) @db.Uuid
  listingId    String    @db.Uuid
  listing      Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)
  type         MediaType
  url          String
  thumbnailUrl String?
  position     Int       @default(0)
}

model ListingVariant {
  id               String  @id @default(uuid(7)) @db.Uuid
  listingId        String  @db.Uuid
  listing          Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
  sku              String?
  optionName       String?
  optionValue      String?
  priceDeltaAmount BigInt  @default(0)
  stockQuantity    Int     @default(0)
  stockVersion     Int     @default(0)
}

model ListingStats {
  listingId     String   @id @db.Uuid
  listing       Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)
  viewCount     BigInt   @default(0)
  favoriteCount BigInt   @default(0)
  ratingAvg     Float    @default(0)
  reviewCount   Int      @default(0)
  updatedAt     DateTime @updatedAt
}

model Collection {
  id          String         @id @default(uuid(7)) @db.Uuid
  ownerId     String         @db.Uuid
  owner       User           @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  type        CollectionType @default(seller) // ➕ seller shelf vs buyer's saved list
  name        String
  slug        String? // ➕ web SEO
  description String?
  coverAssetId String?       @db.Uuid // ➕ "collectionImage"
  listingCount Int           @default(0) // ➕ counter — "itemCount"
  position    Int            @default(0) // ➕ seller ordering
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt // ➕
  deletedAt   DateTime? // ➕

  listings CollectionListing[]

  @@unique([ownerId, name]) // ➕ "Add New Collection" duplicates rejected by the DB
  @@unique([ownerId, slug]) // ➕
  @@index([ownerId])
  @@index([ownerId, type, position]) // ➕
}

model CollectionListing {
  collectionId String     @db.Uuid
  listingId    String     @db.Uuid
  position     Int        @default(0) // "productOrder"
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  listing      Listing    @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@id([collectionId, listingId])
}

// ⚠️ DECISION PENDING (01 §9.1): fold into Listing. Two catalogs will drift.
model Product {
  id          String   @id @default(uuid(7)) @db.Uuid
  sellerId    String   @db.Uuid
  title       String
  description String?
  price       BigInt
  quantity    Int?
  images      String[]
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([sellerId, status])
}
```

---

## 7. Orders

**Changes:** `Order` +13 fields, +2 indexes · `CartItem` +1 · `TrackingEntry` +4 ·
`Review` +4 and a unique · `ReviewImage` new. `ProcessDef`, `OrderTransition`, `LineItem`,
`StockReservation`, `ScheduledTransition` unchanged.

```prisma
model ProcessDef {
  alias      String       @id
  name       OrderProcess
  definition Json
  active     Boolean      @default(true)
}

model Order {
  id String @id @default(uuid(7)) @db.Uuid

  // ➕ The human-readable id every screen calls "Order ID" / "Order number".
  //    Generated by a Postgres sequence (§14) — the only place uniqueness can be
  //    guaranteed under concurrent checkout. The UUID stays internal.
  orderNumber String @unique @default(dbgenerated("('PST-' || lpad(nextval('order_number_seq')::text, 8, '0'))"))

  processAlias       String
  processName        OrderProcess
  state              String // free-form FSM state, driven by ProcessDef
  lastTransition     String?
  lastTransitionedAt DateTime?

  // ➕ Presentation projection of `state`, written in the SAME transaction as every
  //    transition. The status-filter screen needs COUNT(*) GROUP BY over millions of
  //    rows — that cannot run against a free-form `state String`.
  statusBucket OrderStatusBucket @default(pendingPayment)

  customerId    String  @db.Uuid
  providerId    String  @db.Uuid
  listingId     String? @db.Uuid
  parentOrderId String? @db.Uuid
  customer      User    @relation("OrderCustomer", fields: [customerId], references: [id])
  provider      User    @relation("OrderProvider", fields: [providerId], references: [id])

  // Money snapshots (derived from line items, persisted for fast reads)
  payinTotalAmount  BigInt @default(0)
  payoutTotalAmount BigInt @default(0)
  currency          String @db.Char(3)

  // Buyer/shipping context
  shippingAddress  Json?
  cartSnapshot     Json?
  salesTaxSnapshot Json?
  protectedData    Json  @default("{}")
  metadata         Json  @default("{}")

  // ➕ Terms as agreed at purchase — editing the policy must not change them retroactively
  returnPolicySnapshot Json?

  // ➕ Checkout extras
  buyerNote     String? // "Seller message" on Review & Pay
  discountCode  String? // snapshot of the applied "Promo code"

  // ➕ Lifecycle timestamps (each drives a screen, an email, and a reminder)
  shippedAt           DateTime?
  deliveredAt         DateTime?
  estimatedDeliveryAt DateTime? // snapshot at ship time
  completedAt         DateTime?
  canceledAt          DateTime?
  canceledByUserId    String?   @db.Uuid
  cancellationReason  String?

  // ➕ Denormalized from Refund, so the order list does not need a join
  refundStatus RefundStatus @default(none)

  // Payout/escrow tracking — the irreversibility boundary
  payoutReleased   Boolean   @default(false)
  payoutReleasedAt DateTime?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime? // ➕ soft delete (CLAUDE.md §1)

  lineItems     LineItem[]
  transitions   OrderTransition[]
  reservations  StockReservation[]
  reviews       Review[]
  scheduled     ScheduledTransition[]
  paymentIntent PaymentIntent?
  payout        Payout?
  refunds       Refund[]
  disputes      Dispute[] // ➕
  conversation  Conversation? // ➕ ⚠️ replaces the old Message[] relation

  @@index([customerId, state])
  @@index([providerId, state])
  @@index([listingId])
  @@index([state, lastTransitionedAt])
  @@index([parentOrderId])
  @@index([customerId, statusBucket, createdAt]) // ➕ My Orders + status chips
  @@index([providerId, statusBucket, createdAt]) // ➕ seller Orders
  @@index([orderNumber]) // ➕ support lookup
}

model OrderTransition {
  id          String   @id @default(uuid(7)) @db.Uuid
  orderId     String   @db.Uuid
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  transition  String
  fromState   String?
  toState     String
  actor       String // customer | provider | operator | system
  actorUserId String?  @db.Uuid
  metadata    Json     @default("{}")
  createdAt   DateTime @default(now())

  @@index([orderId, createdAt]) // "Order activity" timeline
}

model LineItem {
  id              String       @id @default(uuid(7)) @db.Uuid
  orderId         String       @db.Uuid
  order           Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  code            LineItemCode
  unitPriceAmount BigInt
  currency        String       @db.Char(3)
  quantity        Int          @default(1)
  percentage      Decimal?     @db.Decimal(9, 4)
  lineTotalAmount BigInt
  includeFor      IncludeFor[]
  reversal        Boolean      @default(false)

  @@index([orderId])
}

model StockReservation {
  id        String   @id @default(uuid(7)) @db.Uuid
  orderId   String?  @db.Uuid
  order     Order?   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  listingId String   @db.Uuid
  variantId String?  @db.Uuid
  quantity  Int
  state     String // pending | confirmed | expired | canceled
  expiresAt DateTime // 15-minute hold
  createdAt DateTime @default(now())

  @@index([listingId, state])
  @@index([expiresAt, state])
}

model ScheduledTransition {
  id         String   @id @default(uuid(7)) @db.Uuid
  orderId    String   @db.Uuid
  order      Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  transition String
  guardState String
  runAt      DateTime
  status     String   @default("pending")
  attempts   Int      @default(0)

  @@index([status, runAt])
}

model CartItem {
  id        String   @id @default(uuid(7)) @db.Uuid
  userId    String?  @db.Uuid // 🔄 nullable for guest carts (web)
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessionId String? // ➕ anonymous web cart; merged into userId at login
  listingId String   @db.Uuid
  variant   String?
  size      String?
  quantity  Int      @default(1)
  addedAt   DateTime @default(now())

  @@unique([userId, listingId, variant, size])
  @@unique([sessionId, listingId, variant, size]) // ➕
  @@index([sessionId])
  // CHECK (userId IS NOT NULL OR sessionId IS NOT NULL) → §14
}

model Review {
  id        String   @id @default(uuid(7)) @db.Uuid
  orderId   String   @db.Uuid
  listingId String?  @db.Uuid
  authorId  String   @db.Uuid
  subjectId String   @db.Uuid
  type      String // ofProvider | ofCustomer
  rating    Int // 1..5
  content   String?
  state     String   @default("public") // public | pending

  // ➕ "sellerResponse" (Seller Reviews / Seller Home Reviews)
  responseBody String?
  respondedAt  DateTime?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt // ➕
  deletedAt DateTime? // ➕ moderation removal

  order   Order        @relation(fields: [orderId], references: [id])
  listing Listing?     @relation(fields: [listingId], references: [id])
  images  ReviewImage[] // ➕

  @@unique([orderId, authorId, type]) // ➕ THE review-integrity guarantee
  @@index([subjectId, state])
  @@index([listingId, state, createdAt])
  // CHECK (rating BETWEEN 1 AND 5) → §14
}

// 🆕 "reviewImages" (Seller Reviews Screen)
model ReviewImage {
  id       String @id @default(uuid(7)) @db.Uuid
  reviewId String @db.Uuid
  review   Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  assetId  String @db.Uuid
  position Int    @default(0)

  @@index([reviewId, position])
}
```

> **Why `@@unique([orderId, authorId, type])` matters.** Without it a retried request or a
> double-tapped submit writes two 5-star reviews and silently corrupts `ratingAvg` and the
> `rating1..5` histogram. There is no way to detect that after the fact.

---

## 8. Disputes

Both new. Six of the design's thirteen order statuses are dispute states and four notification
types reference them, yet nothing models a dispute today.

```prisma
// 🆕
model Dispute {
  id      String @id @default(uuid(7)) @db.Uuid
  orderId String @db.Uuid
  order   Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)

  openedByUserId String  @db.Uuid // buyer or seller
  reason         String // vocabulary from ConfigAsset
  description    String?

  status DisputeStatus @default(open)

  // Seller's "refundOffered" proposal
  offerAmount    BigInt?
  offerCurrency  String?   @db.Char(3)
  offerExpiresAt DateTime?

  resolution       DisputeResolution?
  resolvedByUserId String?            @db.Uuid // admin on escalation
  escalatedAt      DateTime?
  resolvedAt       DateTime?
  adminNote        String? // internal only — never serialized to a party

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  evidence DisputeEvidence[]

  @@index([orderId])
  @@index([status, createdAt]) // admin dispute queue
  // PARTIAL UNIQUE(orderId) WHERE status NOT IN ('resolved','withdrawn') → §14
  // CHECK (offerAmount IS NULL OR offerAmount > 0)                       → §14
}

// 🆕
model DisputeEvidence {
  id               String   @id @default(uuid(7)) @db.Uuid
  disputeId        String   @db.Uuid
  dispute          Dispute  @relation(fields: [disputeId], references: [id], onDelete: Cascade)
  uploadedByUserId String   @db.Uuid
  assetId          String   @db.Uuid
  note             String?
  createdAt        DateTime @default(now())

  @@index([disputeId, createdAt])
}
```

---

## 9. Messaging — the largest structural change ⚠️

Today `Message` **requires** `orderId`. The design needs product conversations that exist before
any order ("Message Seller", `productId` on the messages list), `unreadCount`, read receipts, and
attachments. None of that is expressible on the current model.

```prisma
// 🆕
model Conversation {
  id   String           @id @default(uuid(7)) @db.Uuid
  kind ConversationKind

  buyerId   String  @db.Uuid
  sellerId  String  @db.Uuid
  listingId String? @db.Uuid // set when kind = product
  orderId   String? @unique @db.Uuid // set when kind = order — exactly one thread per order
  order     Order?  @relation(fields: [orderId], references: [id], onDelete: Cascade)

  // Denormalized list-row fields, so the inbox is one indexed read, not N joins
  lastMessageId      String?   @db.Uuid
  lastMessageAt      DateTime?
  lastMessagePreview String? // ≤160 chars

  buyerUnreadCount  Int       @default(0)
  sellerUnreadCount Int       @default(0)
  buyerLastReadAt   DateTime?
  sellerLastReadAt  DateTime?

  buyerArchivedAt  DateTime?
  sellerArchivedAt DateTime?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  messages Message[]

  @@index([sellerId, lastMessageAt(sort: Desc)]) // seller Messages list
  @@index([buyerId, lastMessageAt(sort: Desc)]) // buyer Messages list
  @@index([listingId])
  // PARTIAL UNIQUE(buyerId, sellerId, listingId) WHERE kind = 'product' → §14
  // CHECK ((kind='order' AND orderId IS NOT NULL) OR
  //        (kind='product' AND listingId IS NOT NULL))                  → §14
}

// 🔄 ⚠️ REWORKED — orderId → conversationId, content → body
model Message {
  id             String       @id @default(uuid(7)) @db.Uuid
  conversationId String       @db.Uuid // 🔄 ⚠️ replaces orderId as the parent
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String       @db.Uuid

  kind MessageKind @default(text) // ➕
  body String? // 🔄 renamed from `content`; null when attachment-only

  // ➕ "Message delivery/read status" / "messageStatus"
  deliveredAt DateTime?
  readAt      DateTime?

  // ➕ Client-generated. Makes a send retry a no-op instead of a duplicate message.
  clientMessageId String?

  createdAt DateTime  @default(now())
  deletedAt DateTime? // ➕

  attachments MessageAttachment[]

  @@unique([conversationId, clientMessageId])
  @@index([conversationId, createdAt])
  @@index([senderId])
  // CHECK (body IS NOT NULL OR kind <> 'text') → §14
}

// 🆕 "attachments" (Seller Order Chat Screen)
model MessageAttachment {
  id        String  @id @default(uuid(7)) @db.Uuid
  messageId String  @db.Uuid
  message   Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  assetId   String  @db.Uuid
  position  Int     @default(0)

  @@index([messageId, position])
}
```

**Backfill (must run as a job, not inside the migration):**

1. For each distinct `Message.orderId`, insert one `Conversation` with `kind = order`,
   `buyerId = Order.customerId`, `sellerId = Order.providerId`, `orderId`.
2. Repoint every message to its new `conversationId`.
3. Backfill `lastMessageId` / `lastMessageAt` / `lastMessagePreview` and both unread counts.
4. Only then drop `Message.orderId` and rename `content` → `body`.

---

## 10. Payments & money

**Changes:** `PaymentMethod` +4 · `StripeAccount` +3 · `SellerBalance` and `SellerLedgerEntry` new.
`StripeCustomer`, `PaymentIntent`, `Payout`, `Refund`, `StripeEvent` unchanged.

```prisma
model StripeAccount {
  id              String           @id @default(uuid(7)) @db.Uuid
  userId          String           @unique @db.Uuid
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripeAccountId String           @unique
  country         String?
  status          StripeAcctStatus @default(none)
  chargesEnabled  Boolean          @default(false)
  payoutsEnabled  Boolean          @default(false)
  requirementsDue Json?
  externalLast4   String?

  externalAccountType String? // ➕ "Bank account type" — bank_account | card
  externalBankName    String? // ➕
  payoutsPausedAt     DateTime? // ➕ admin action

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model StripeCustomer {
  id                     String          @id @default(uuid(7)) @db.Uuid
  userId                 String          @unique @db.Uuid
  user                   User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripeCustomerId       String          @unique
  defaultPaymentMethodId String? // "Primary card status" is derived from this
  paymentMethods         PaymentMethod[]
}

model PaymentMethod {
  id         String            @id @default(uuid(7)) @db.Uuid
  customerId String            @db.Uuid
  customer   StripeCustomer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
  stripePmId String            @unique
  type       PaymentMethodType @default(card) // ➕ "Payment wallet"
  brand      String?
  last4      String?
  expMonth   Int?
  expYear    Int?

  cardholderName String? // ➕
  billingAddress Json? // ➕ mirrored from Stripe — never authoritative

  createdAt DateTime  @default(now())
  deletedAt DateTime? // ➕ detach ≠ delete; orders reference it

  @@index([customerId, deletedAt])
}
```

> **Never stored:** `Card number`, `Expiry date` (raw), `CVC`. The Add Card / Edit Card screens are
> Stripe-hosted (PaymentSheet / Elements); the backend exposes a SetupIntent, never a card-fields
> endpoint. Only the Stripe PaymentMethod id, brand, last4 and expiry ever reach this table.

```prisma
model PaymentIntent {
  id                   String    @id @default(uuid(7)) @db.Uuid
  orderId              String    @unique @db.Uuid
  order                Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stripePiId           String    @unique
  clientSecret         String?
  amount               BigInt
  currency             String    @db.Char(3)
  applicationFeeAmount BigInt?
  status               String
  capturedAt           DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}

model Payout {
  id                   String    @id @default(uuid(7)) @db.Uuid
  orderId              String    @unique @db.Uuid
  order                Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stripeTransferId     String?   @unique
  destinationAccountId String
  amount               BigInt
  currency             String    @db.Char(3)
  status               String // pending | paid | failed | reversed
  releasedAt           DateTime?
  createdAt            DateTime  @default(now())
}

model Refund {
  id             String           @id @default(uuid(7)) @db.Uuid
  orderId        String           @db.Uuid
  order          Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stripeRefundId String?          @unique
  mode           RefundMode
  resolution     RefundResolution
  amount         BigInt
  currency       String           @db.Char(3)
  reason         String?
  note           String?
  actor          String?
  createdAt      DateTime         @default(now())

  @@index([orderId])
}

model StripeEvent {
  id          String    @id // Stripe event id (evt_...) — the webhook idempotency guard
  type        String
  payload     Json
  processedAt DateTime?
  createdAt   DateTime  @default(now())
}

// 🆕 The "Earnings" screen. Per CLAUDE.md §6 a balance is NEVER mutated directly —
//    every change is a ledger entry, and the balance is the running total.
model SellerBalance {
  sellerId String @id @db.Uuid
  seller   User   @relation(fields: [sellerId], references: [id], onDelete: Cascade)

  currency String @db.Char(3)

  pendingAmount   BigInt @default(0) // in escrow, not yet released
  availableAmount BigInt @default(0) // released, payable

  lifetimeGrossAmount BigInt @default(0) // "totalEarnings"
  lifetimeFeeAmount   BigInt @default(0) // "platformFee" total

  version   Int      @default(0) // optimistic lock
  updatedAt DateTime @updatedAt

  // CHECK (pendingAmount >= 0 AND availableAmount >= 0) → §14
}

// 🆕 Append-only. No UPDATE, no DELETE, no soft delete — a correction is a new
//    compensating entry.
model SellerLedgerEntry {
  id       String @id @default(uuid(7)) @db.Uuid
  sellerId String @db.Uuid

  orderId  String? @db.Uuid // provenance
  payoutId String? @db.Uuid
  refundId String? @db.Uuid

  type      LedgerEntryType
  direction LedgerDirection
  amount    BigInt // always positive; `direction` carries the sign
  currency  String          @db.Char(3)

  // Running balances after this entry — makes reconciliation a SELECT, not a fold
  pendingAfter   BigInt
  availableAfter BigInt

  // e.g. "payout:{payoutId}", "sale:{orderId}" — THE duplicate-credit guard.
  // A replayed Stripe webhook becomes a no-op instead of a double credit.
  idempotencyKey String @unique

  occurredAt DateTime
  createdAt  DateTime @default(now())

  @@index([sellerId, occurredAt(sort: Desc)])
  @@index([orderId])
  // CHECK (amount > 0) → §14
}
```

---

## 11. Tax & Shipping

**Changes:** `TrackingEntry` +4. `TaxOrder`, `TaxRefund`, `Shipment` unchanged.

```prisma
model TaxOrder {
  id         String    @id // pastel-{orderId}
  orderId    String    @unique @db.Uuid
  amount     BigInt
  shipping   BigInt
  salesTax   BigInt
  toState    String?
  reportedAt DateTime?
  raw        Json
}

model TaxRefund {
  id         String    @id
  orderId    String    @db.Uuid
  amount     BigInt
  salesTax   BigInt
  reportedAt DateTime?
  raw        Json

  @@index([orderId])
}

model Shipment {
  id           String          @id @default(uuid(7)) @db.Uuid
  orderId      String          @db.Uuid
  carrier      String?
  service      String?
  shippoRateId String?
  shippoTxId   String?
  labelUrl     String?
  rateAmount   BigInt?
  currency     String?         @db.Char(3)
  createdAt    DateTime        @default(now())
  tracking     TrackingEntry[]

  @@index([orderId])
}

model TrackingEntry {
  id           String    @id @default(uuid(7)) @db.Uuid
  orderId      String    @db.Uuid
  shipmentId   String?   @db.Uuid
  shipment     Shipment? @relation(fields: [shipmentId], references: [id])
  trackingId   String
  trackingLink String?
  carrier      String? // ➕
  status       String? // ➕ "Tracking status" — carrier-normalized
  lastCheckedAt DateTime? // ➕ powers the seller's "trackingStoppedUpdating" alert
  updatedById  String?   @db.Uuid
  createdAt    DateTime  @default(now()) // ➕
  updatedAt    DateTime  @updatedAt

  @@index([orderId])
  @@index([status, lastCheckedAt]) // ➕ the stale-tracking sweep
}
```

---

## 12. Social

**Changes:** `Story` +6 · `Highlight` +4 · `HighlightStory` +1 relation ·
`StoryComment` new · `Show` +5. `Follow`, `Favorite`, `StoryLike`, `ShowSession` unchanged.

```prisma
model Follow {
  followerId  String   @db.Uuid
  followingId String   @db.Uuid
  source      String?
  status      String   @default("active")
  createdAt   DateTime @default(now())
  follower    User     @relation("Follower", fields: [followerId], references: [id], onDelete: Cascade)
  following   User     @relation("Following", fields: [followingId], references: [id], onDelete: Cascade)

  @@id([followerId, followingId])
  @@index([followingId, status])
  @@index([followerId, status])
}

model Favorite {
  userId    String   @db.Uuid
  listingId String   @db.Uuid
  createdAt DateTime @default(now())

  @@id([userId, listingId]) // "isFavorite" is an EXISTS against this PK — batch-loaded, never N+1
  @@index([listingId])
}

model Story {
  id           String      @id @default(uuid(7)) @db.Uuid
  userId       String      @db.Uuid
  listingId    String?     @db.Uuid // "taggedProduct"
  storyType    String // public | highlight
  mediaType    MediaType
  mediaUrl     String
  thumbnailUrl String?
  description  String? // "caption" / "storyText"

  status   StoryStatus @default(draft) // ➕
  postedAt DateTime? // ➕

  // ➕ "keepAfter24Hours" — when true, expiresAt is left null
  keepAfterExpiry Boolean @default(false)

  likeCount    Int @default(0)
  commentCount Int @default(0) // ➕
  shareCount   Int @default(0) // ➕

  showOnProductPage Boolean   @default(false)
  createdAt         DateTime  @default(now())
  expiresAt         DateTime? // 24h for public stories
  deletedAt         DateTime? // ➕

  comments        StoryComment[] // ➕
  highlightLinks  HighlightStory[] @relation("StoryHighlights") // ➕ back-relation
  coverForHighlights Highlight[]   @relation("HighlightCover") // ➕ back-relation

  @@index([userId, createdAt])
  @@index([listingId])
  @@index([expiresAt])
  @@index([userId, status, postedAt]) // ➕
}

model StoryLike {
  storyId   String   @db.Uuid
  userId    String   @db.Uuid
  createdAt DateTime @default(now())

  @@id([storyId, userId]) // "isLiked" is an EXISTS against this PK
}

// 🆕 "commentCount" — see 01 §9.2, confirm comments are in scope for v1
model StoryComment {
  id        String    @id @default(uuid(7)) @db.Uuid
  storyId   String    @db.Uuid
  story     Story     @relation(fields: [storyId], references: [id], onDelete: Cascade)
  authorId  String    @db.Uuid
  body      String
  createdAt DateTime  @default(now())
  deletedAt DateTime?

  @@index([storyId, createdAt])
}

model Highlight {
  id           String  @id @default(uuid(7)) @db.Uuid
  userId       String  @db.Uuid
  name         String
  coverStoryId String? @db.Uuid
  coverStory   Story?  @relation("HighlightCover", fields: [coverStoryId], references: [id]) // ➕

  isPublished Boolean   @default(false) // ➕
  position    Int       @default(0) // ➕
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt // ➕
  deletedAt   DateTime? // ➕

  stories HighlightStory[]

  @@unique([userId, name]) // ➕
  @@index([userId, position])
}

model HighlightStory {
  highlightId String    @db.Uuid
  storyId     String    @db.Uuid
  position    Int       @default(0) // "storyOrder"
  highlight   Highlight @relation(fields: [highlightId], references: [id], onDelete: Cascade)
  story       Story     @relation("StoryHighlights", fields: [storyId], references: [id], onDelete: Cascade) // ➕ FK was missing

  @@id([highlightId, storyId])
  @@index([storyId])
}

model Show {
  id                   String        @id
  creatorId            String        @db.Uuid
  title                String?
  description          String? // ➕
  status               ShowStatus    @default(scheduled)

  // ➕ "startType" — now | scheduled
  startMode ShowStartMode @default(scheduled)

  scheduledAt    DateTime? // startDate + startTime + timezone collapse to ONE UTC instant
  scheduledEndAt DateTime? // ➕ "setEndTime" + endDate + endTime
  timezone       String? // ➕ IANA — DISPLAY ONLY; scheduledAt stays UTC

  startedAt DateTime?
  endedAt   DateTime?

  connectionState      String?
  sellerDisconnectedAt DateTime?
  graceEndsAt          DateTime?
  currentSessionId     String?
  sessionCount         Int           @default(0)
  totalDuration        Int           @default(0)
  endReason            String?
  lastSellerEventAt    DateTime?
  pinnedProductId      String?       @db.Uuid
  productIds           String[]      @db.Uuid
  options              Json          @default("{}") // ➕ "showOptions"
  createdAt            DateTime      @default(now())
  sessions             ShowSession[]

  @@index([status, graceEndsAt])
  @@index([creatorId, status])
  @@index([status, scheduledAt]) // ➕ upcoming-live reminders
  // CHECK (scheduledEndAt IS NULL OR scheduledAt IS NULL OR scheduledEndAt > scheduledAt) → §14
}

model ShowSession {
  id        String    @id @default(uuid(7)) @db.Uuid
  showId    String
  show      Show      @relation(fields: [showId], references: [id], onDelete: Cascade)
  sessionId String
  startedAt DateTime
  endedAt   DateTime?
  duration  Int?
  status    String    @default("active")

  @@unique([showId, sessionId])
  @@index([showId])
}
```

> **`startDate` + `startTime` + `timezone` are three UI inputs for one instant.** They collapse to a
> single UTC `scheduledAt`; `timezone` is kept only so the seller sees the show back in the zone they
> scheduled it in. Storing local time is exactly the mistake CLAUDE.md §1 forbids.

---

## 13. Notifications

**Changes:** `Notification` +4 · `NotificationPreference` slimmed · `NotificationSetting` new.
`PushToken`, `OrderEmailReminder` unchanged.

```prisma
model Notification {
  id             String               @id @default(uuid(7)) @db.Uuid
  recipientId    String               @db.Uuid
  type           String
  category       NotificationCategory @default(system) // ➕ "Notification category"
  recipientMode  String? // buyer | seller
  title          String? // ➕ server-rendered "Notification title"
  body           String? // ➕ "Notification message"
  deepLink       String? // ➕ resolves "Related order/product/message"
  actorId        String?              @db.Uuid
  actorName      String?
  actorImage     String?
  listingId      String?              @db.Uuid
  listingTitle   String?
  orderId        String?              @db.Uuid
  showId         String?              @db.Uuid
  storyId        String?              @db.Uuid
  messagePreview String?
  scheduledKey   String? // deterministic dedup key
  sendAt         DateTime?
  read           Boolean              @default(false)
  readAt         DateTime?
  createdAt      DateTime             @default(now())

  @@unique([scheduledKey])
  @@index([recipientId, createdAt])
  @@index([recipientId, read])
  @@index([recipientId, category, createdAt]) // ➕ category tabs
  @@index([type, showId])
  @@index([sendAt])
  // PARTIAL UNIQUE(recipientId, orderId, type) WHERE orderId IS NOT NULL → performance.sql
}

// 🔄 Slimmed. `enabled` moves to NotificationSetting rows; `priorities` stays JSON
//    (FCM channel priority, low cardinality, never filtered on).
model NotificationPreference {
  userId      String    @id @db.Uuid
  priorities  Json      @default("{}") // {type -> low|default|high}
  pausedUntil DateTime? // ➕ "Pause notifications" — null = not paused
  updatedAt   DateTime  @updatedAt
  // ⚠️ `enabled Json` REMOVED — backfill into NotificationSetting rows first
}

// 🆕 One row per toggle. The design specifies 47 named toggles across 4 screens
//    (buyer push 13, buyer email 15, seller push 6, seller email 13).
//    Opaque JSON cannot answer "who has priceDrop enabled" without scanning every
//    user — unusable for fan-out.
model NotificationSetting {
  id      String              @id @default(uuid(7)) @db.Uuid
  userId  String              @db.Uuid
  mode    RecipientMode
  channel NotificationChannel
  type    String // validated at the DTO layer against the ConfigAsset catalog,
  //        so a new notification type ships without a migration
  enabled Boolean             @default(true)

  updatedAt DateTime @updatedAt

  @@unique([userId, mode, channel, type])
  @@index([channel, type, enabled]) // THE fan-out index — the whole point of this table
}

model PushToken {
  id            String   @id @default(uuid(7)) @db.Uuid
  userId        String   @db.Uuid
  token         String
  platform      String? // ios | android | web
  appVersion    String?
  bundleVersion String?
  revoked       Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, token])
  @@index([userId, revoked])
}

model OrderEmailReminder {
  id            String   @id // {orderId}_{reminderType}
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

> **Absent row = platform default.** Only explicit user choices are written, so adding a notification
> type does not require backfilling 47 rows × every user.
>
> `paymentReceipt`, `refundIssued`, `paymentIssue` and `orderConfirmed` are **transactional**, not
> marketing. Flag them non-disableable in the catalog regardless of what the settings screen renders,
> or the platform ships without a receipt trail.

---

## 14. Promotions, config, analytics, admin

**Changes:** `ShopPromotion` +5, 1 changed · `ShopPromotionUsage` ⚠️ · `DiscountUsage` ⚠️ ·
`SellerAnalyticsDaily`, `AdminMembership`, `ImpersonationSession`, `FeatureFlag` new ·
`ContentReport` +7 · `AuditLog` +6 · `AccountDeletionRequest` +3.

```prisma
model Discount {
  id             String          @id @default(uuid(7)) @db.Uuid
  code           String          @unique
  isActive       Boolean         @default(true)
  percentage     Decimal         @db.Decimal(5, 2)
  remainingUsage Int?
  showOn         String[]
  applyOn        String[]
  title          String?
  expiresAt      DateTime?
  usages         DiscountUsage[]
}

model DiscountUsage {
  id         String   @id @default(uuid(7)) @db.Uuid
  discountId String   @db.Uuid
  discount   Discount @relation(fields: [discountId], references: [id], onDelete: Cascade)
  userId     String   @db.Uuid
  orderId    String?  @db.Uuid
  usedAt     DateTime @default(now())

  // ⚠️ @@unique([userId, discountId]) REMOVED — it hard-capped every discount at one
  //    use per customer. Replaced by idempotency on the order + a transactional
  //    per-customer COUNT under a row lock.
  @@unique([discountId, orderId])
  @@index([discountId, userId])
}

model ShopPromotion {
  id       String @id @default(uuid(7)) @db.Uuid
  sellerId String @db.Uuid
  name     String
  code     String

  discountType    DiscountType @default(percentage) // ➕ design has BOTH % and fixed amount
  discountPercent Decimal?     @db.Decimal(5, 2) // 🔄 now nullable
  discountAmount  BigInt? // ➕ "discountAmount"
  currency        String?      @db.Char(3) // ➕

  isActive        Boolean   @default(true)
  usageLimit      Int? // "totalUses"
  usesPerCustomer Int? // ➕ "usesPerPerson"; null = unlimited
  usageCount      Int       @default(0)
  orderCount      Int       @default(0) // ➕
  revenue         BigInt    @default(0)
  discountGiven   BigInt    @default(0)
  shares          Int       @default(0)
  startsAt        DateTime? // ➕ "startDate" — only expiresAt existed
  expiresAt       DateTime?
  createdAt       DateTime  @default(now()) // ➕
  updatedAt       DateTime  @updatedAt // ➕
  deletedAt       DateTime?

  usages ShopPromotionUsage[]

  @@unique([sellerId, code])
  @@index([sellerId, isActive])
  @@index([code, isActive]) // ➕ redemption lookup
  // CHECK ((discountType='percentage' AND discountPercent IS NOT NULL) OR
  //        (discountType='fixedAmount' AND discountAmount IS NOT NULL))     → §15
  // CHECK (expiresAt IS NULL OR startsAt IS NULL OR expiresAt > startsAt)   → §15
}

model ShopPromotionUsage {
  id          String        @id @default(uuid(7)) @db.Uuid
  promotionId String        @db.Uuid
  promotion   ShopPromotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  userId      String        @db.Uuid
  orderId     String?       @db.Uuid
  usedAt      DateTime      @default(now())

  // ⚠️ @@unique([userId, promotionId]) REMOVED — see below
  @@unique([promotionId, orderId]) // idempotency: a retried checkout cannot double-count
  @@index([promotionId, userId]) // the per-customer limit COUNT
}
```

> **⚠️ Coupon-abuse vector — both halves must land together.** The current
> `@@unique([userId, promotionId])` hard-caps every promotion at one use per customer, contradicting
> `usesPerPerson`. But dropping it *without* adding a transactional `COUNT(*) … WHERE promotionId AND
> userId` **against a row-locked `ShopPromotion`** allows unlimited redemption. Do not ship one
> without the other.

```prisma
model CommissionConfig {
  id                 Int      @id @default(1)
  providerPercentage Decimal  @db.Decimal(5, 2)
  customerPercentage Decimal  @db.Decimal(5, 2)
  updatedAt          DateTime @updatedAt
}

model ConfigAsset {
  key       String   @id
  version   String
  data      Json
  updatedAt DateTime @updatedAt
}

model CmsPage {
  slug        String    @id
  data        Json
  publishedAt DateTime?
  updatedAt   DateTime  @updatedAt
}

model MediaAsset {
  id          String   @id @default(uuid(7)) @db.Uuid
  ownerId     String?  @db.Uuid
  kind        String // listing-image | profile-image | story | appeal | evidence | review
  storageKey  String
  contentType String?
  width       Int?
  height      Int?
  createdAt   DateTime @default(now())

  profileImageUsers User[] @relation("UserProfileImage")

  @@index([ownerId, kind]) // ➕
}

// Platform-wide (unchanged)
model AnalyticsDaily {
  day                String @id // YYYY-MM-DD
  pageViews          BigInt @default(0)
  uniqueSessions     BigInt @default(0)
  signups            BigInt @default(0)
  emailVerifications BigInt @default(0)
  cartAdds           BigInt @default(0)
  checkoutStarts     BigInt @default(0)
  paymentStepViews   BigInt @default(0)
  reviewStepViews    BigInt @default(0)
  checkoutCompletes  BigInt @default(0)
  shopVisits         Json   @default("{}")
  referrals          Json   @default("{}")
}

// 🆕 The "Shop Analytics" screen. conversionRate, averageOrderValue, salesOverTime and
//    topListings are all COMPUTED from this table + LineItem — none is a stored field.
model SellerAnalyticsDaily {
  sellerId String @db.Uuid
  day      String // YYYY-MM-DD (UTC)

  profileViews     BigInt @default(0)
  listingViews     BigInt @default(0)
  orderCount       Int    @default(0)
  grossSalesAmount BigInt @default(0)
  refundedAmount   BigInt @default(0)
  currency         String @default("USD") @db.Char(3)
  favoritesAdded   Int    @default(0)
  followersGained  Int    @default(0)

  @@id([sellerId, day])
  @@index([day])
}

model AuditLog {
  id         String   @id @default(uuid(7)) @db.Uuid
  actor      String
  action     String
  entityType String
  entityId   String?
  detail     Json     @default("{}")

  // ➕ CLAUDE.md §9 requires user ID, action, OLD value, NEW value, timestamp, IP,
  //    request ID. Four of those seven were missing.
  actorUserId String? @db.Uuid
  beforeValue Json?
  afterValue  Json?
  ip          String?
  requestId   String?
  userAgent   String?

  createdAt DateTime @default(now())

  @@index([entityType, entityId])
  @@index([createdAt])
  @@index([actorUserId, createdAt]) // ➕
  @@index([requestId]) // ➕
}

// 🆕 There is no admin identity today (UserType was customer|seller|provider),
//    yet every queue model assumes an admin actor.
model AdminMembership {
  userId String    @id @db.Uuid
  user   User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   AdminRole
  grantedByUserId String?   @db.Uuid
  grantedAt       DateTime  @default(now())
  revokedAt       DateTime?

  @@index([role, revokedAt])
}

// 🆕 The `loginAs` capability carried over from Sharetribe. Impersonation without an
//    audit trail is indefensible.
model ImpersonationSession {
  id           String    @id @default(uuid(7)) @db.Uuid
  adminUserId  String    @db.Uuid
  targetUserId String    @db.Uuid
  reason       String
  ip           String?
  requestId    String?
  startedAt    DateTime  @default(now())
  endedAt      DateTime?

  @@index([targetUserId, startedAt])
  @@index([adminUserId, startedAt])
}

// 🆕 CLAUDE.md §11 — large features ship behind flags
model FeatureFlag {
  key               String   @id
  description       String?
  enabled           Boolean  @default(false)
  rolloutPercentage Int      @default(0)
  enabledUserIds    String[] @db.Uuid
  updatedByUserId   String?  @db.Uuid
  updatedAt         DateTime @updatedAt

  // CHECK (rolloutPercentage BETWEEN 0 AND 100) → §15
}

model RestrictionAppeal {
  id                String    @id @default(uuid(7)) @db.Uuid
  userId            String    @db.Uuid
  email             String?
  subject           String?
  description       String?
  attachmentUrl     String?
  userType          String?
  restrictionReason String?
  status            String    @default("pending")
  adminNote         String?
  adminActor        String?
  reviewedAt        DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([status, createdAt])
}

model UserRestriction {
  id                   String   @id @default(uuid(7)) @db.Uuid
  userId               String   @db.Uuid
  action               String
  reason               String
  userType             String   @default("customer")
  closedListings       Int?
  revokedWaitlistCount Int?
  adminNote            String?
  adminActor           String
  createdAt            DateTime @default(now())

  @@index([userId, createdAt])
}

model ContentReport {
  id             String   @id @default(uuid(7)) @db.Uuid
  contentType    String
  contentId      String
  reason         String
  isDmca         Boolean  @default(false)
  details        String? // "description"
  reporterEmail  String?
  reporterUserId String?  @db.Uuid
  status         String   @default("open") // "reportStatus"

  // ➕ "Report Listing Screen": evidence, evidenceType, sourceUrl
  evidenceAssetId  String?   @db.Uuid
  evidenceType     String? // screenshot | link | other
  sourceUrl        String?
  assignedToUserId String?   @db.Uuid
  resolution       String?
  reviewedByUserId String?   @db.Uuid
  reviewedAt       DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt // ➕

  @@index([status, createdAt])
  @@index([isDmca, status])
  @@index([contentType, contentId]) // ➕ "has this listing been reported before?"
}

model AccountDeletionRequest {
  id               String    @id @default(uuid(7)) @db.Uuid
  userId           String?   @db.Uuid
  email            String
  userType         String?
  status           String    @default("pending")
  resolution       String?
  reason           String? // ➕ "Delete reason" free text
  reasonCode       String? // ➕ enum-ish, for analytics
  handledByUserId  String?   @db.Uuid // ➕
  requestedAt      DateTime  @default(now())
  completedAt      DateTime?

  @@index([status, requestedAt])
}

model Waitlist {
  id            String   @id @default(uuid(7)) @db.Uuid
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

  @@index([status, createdAt])
}

model Outbox {
  id        String       @id @default(uuid(7)) @db.Uuid
  topic     String
  payload   Json
  status    OutboxStatus @default(pending)
  attempts  Int          @default(0)
  createdAt DateTime     @default(now())
  sentAt    DateTime?

  @@index([status, createdAt])
}

model IdempotencyKey {
  key        String   @id
  scope      String
  response   Json?
  statusCode Int?
  createdAt  DateTime @default(now())

  @@index([createdAt])
}

model NativeLog {
  id        String   @id @default(uuid(7)) @db.Uuid
  level     String   @default("info")
  event     String   @default("unknown")
  data      Json     @default("{}")
  ua        String?
  origin    String?
  createdAt DateTime @default(now())
  expiresAt DateTime

  @@index([createdAt])
}

model DeviceBundle {
  deviceId      String   @id
  bundleVersion String   @default("unknown")
  bundleLabel   String   @default("")
  release       String   @default("")
  committedAt   String   @default("")
  platform      String
  appVersion    String   @default("")
  buildNumber   String   @default("")
  userId        String?  @db.Uuid
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @updatedAt

  @@index([bundleVersion])
  @@index([userId])
}
```

---

## 15. Raw SQL companion

Prisma cannot express partial unique indexes, `CHECK` constraints, or sequences. These are **not
optional** — several are the only thing preventing a duplicate charge or a double thread. They ship
as a hand-written migration step alongside `prisma migrate`.

```sql
-- ─── Sequence for Order.orderNumber (must exist BEFORE the Order migration) ───
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100000;

-- ─── Partial unique indexes ──────────────────────────────────────────────────

-- One default address per type, per user. Application code alone loses this race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_address_default_per_type
  ON "Address" ("userId", "type")
  WHERE "isDefault" AND "deletedAt" IS NULL;

-- One default policy per seller
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_policy_default
  ON "ShippingPolicy" ("sellerId") WHERE "isDefault" AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_policy_default
  ON "ReturnPolicy" ("sellerId") WHERE "isDefault" AND "deletedAt" IS NULL;

-- One product conversation per (buyer, seller, listing).
-- THIS is what makes "Message Seller" idempotent — without it, two taps = two threads.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_product
  ON "Conversation" ("buyerId", "sellerId", "listingId")
  WHERE "kind" = 'product' AND "deletedAt" IS NULL;

-- One open dispute per order
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_open_per_order
  ON "Dispute" ("orderId")
  WHERE "status" NOT IN ('resolved', 'withdrawn') AND "deletedAt" IS NULL;

-- One live seller application per email
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_application_live_email
  ON "SellerApplication" ("email")
  WHERE "status" NOT IN ('rejected', 'withdrawn') AND "deletedAt" IS NULL;

-- Existing (already in performance.sql) — retained for completeness
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_order_type
  ON "Notification" ("recipientId", "orderId", "type") WHERE "orderId" IS NOT NULL;

-- ─── CHECK constraints ───────────────────────────────────────────────────────

ALTER TABLE "Review"
  ADD CONSTRAINT ck_review_rating CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "ReturnPolicy"
  ADD CONSTRAINT ck_return_window
  CHECK (NOT "acceptsReturns" OR "returnWindowDays" IS NOT NULL);

ALTER TABLE "ShippingPolicy"
  ADD CONSTRAINT ck_handling_time CHECK ("handlingTimeDays" BETWEEN 0 AND 30);

ALTER TABLE "ListingShippingOption"
  ADD CONSTRAINT ck_transit_range
  CHECK ("transitMinDays" IS NULL OR "transitMaxDays" IS NULL
         OR "transitMaxDays" >= "transitMinDays");

ALTER TABLE "ShopPromotion"
  ADD CONSTRAINT ck_promo_discount_present
  CHECK (("discountType" = 'percentage'  AND "discountPercent" IS NOT NULL)
      OR ("discountType" = 'fixedAmount' AND "discountAmount"  IS NOT NULL));

ALTER TABLE "ShopPromotion"
  ADD CONSTRAINT ck_promo_window
  CHECK ("expiresAt" IS NULL OR "startsAt" IS NULL OR "expiresAt" > "startsAt");

ALTER TABLE "Conversation"
  ADD CONSTRAINT ck_conversation_target
  CHECK (("kind" = 'order'   AND "orderId"   IS NOT NULL)
      OR ("kind" = 'product' AND "listingId" IS NOT NULL));

ALTER TABLE "Message"
  ADD CONSTRAINT ck_message_body CHECK ("body" IS NOT NULL OR "kind" <> 'text');

ALTER TABLE "CartItem"
  ADD CONSTRAINT ck_cart_owner
  CHECK ("userId" IS NOT NULL OR "sessionId" IS NOT NULL);

ALTER TABLE "SellerBalance"
  ADD CONSTRAINT ck_balance_non_negative
  CHECK ("pendingAmount" >= 0 AND "availableAmount" >= 0);

ALTER TABLE "SellerLedgerEntry"
  ADD CONSTRAINT ck_ledger_amount_positive CHECK ("amount" > 0);

ALTER TABLE "Dispute"
  ADD CONSTRAINT ck_dispute_offer CHECK ("offerAmount" IS NULL OR "offerAmount" > 0);

ALTER TABLE "Show"
  ADD CONSTRAINT ck_show_window
  CHECK ("scheduledEndAt" IS NULL OR "scheduledAt" IS NULL
         OR "scheduledEndAt" > "scheduledAt");

ALTER TABLE "FeatureFlag"
  ADD CONSTRAINT ck_rollout_pct CHECK ("rolloutPercentage" BETWEEN 0 AND 100);

-- ─── Append-only guard on the ledger ─────────────────────────────────────────
-- The ledger is the money audit trail. A correction is a NEW compensating entry,
-- never an UPDATE. Enforce it in the database, not by convention.
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SellerLedgerEntry is append-only (attempted %)', TG_OP;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_append_only
  BEFORE UPDATE OR DELETE ON "SellerLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
```

---

## 16. Decision needed: referential integrity

The current schema references `User` (and several other parents) by plain `@db.Uuid` column with
**no Prisma relation**, in roughly 35 places:

`Credential.userId` · `EmailToken.userId` · `Message.senderId` · `Review.authorId` ·
`Review.subjectId` · `Favorite.userId` · `Favorite.listingId` · `Story.userId` · `Story.listingId` ·
`StoryLike.*` · `Highlight.userId` · `Notification.recipientId` · `Notification.actorId` ·
`NotificationPreference.userId` · `PushToken.userId` · `Show.creatorId` · `ShopPromotion.sellerId` ·
`DiscountUsage.userId` · `MediaAsset.ownerId` · `ContentReport.reporterUserId` ·
`AccountDeletionRequest.userId` · `Waitlist.userId` · `CartItem.listingId` ·
`StockReservation.listingId` · `Shipment.orderId` · `TrackingEntry.orderId` · `TaxOrder.orderId` · …

**No Prisma relation means no `FOREIGN KEY` constraint in Postgres.** Nothing stops a row pointing
at a deleted user, and nothing cascades. That sits directly against CLAUDE.md §1 ("Enforce business
rules with real constraints: PRIMARY KEY, **FOREIGN KEY**, UNIQUE, CHECK…").

I have **kept the existing convention** in this proposal so the diff stays reviewable and scoped to
the design-field work. But it is a real gap and it is your call:

| Option | Cost | Result |
|---|---|---|
| **A — Add relations** | ~35 back-relation fields on `User`; one migration adding FKs; must resolve any existing orphans first | Full referential integrity, real cascades |
| **B — Keep as-is** | none | Orphan rows remain possible; every join is unguarded |
| **C — Selective** | ~10 relations on the money/order path only (`Message`, `Review`, `Favorite`, `Story`, `Notification`) | Integrity where corruption is most expensive |

**Recommendation: C now, A later.** The money and order paths are where an orphan actually costs
something. Adding FKs to a table with pre-existing orphans fails the migration, so option A needs an
orphan audit first — worth doing, but not worth blocking this schema on.

---

## 17. Verification checklist

Re-extract and re-validate at any time — this is the exact command used to verify this document:

```bash
awk '/^```prisma$/{f=1;next} /^```$/{f=0} f' \
  schema_adjustment_design/02-proposed-prisma-schema.md > /tmp/proposed.prisma
npx prisma validate --schema=/tmp/proposed.prisma
# → "The schema is valid 🚀"  ·  88 models, 42 enums
```

Then go through the list below. Each line is a question the schema should already answer.

**Coverage**

- [ ] Every screen in the raw dump maps to at least one model (see [01 §2](./01-normalized-field-catalog.md#2-alias-resolution-design-name--canonical-field))
- [ ] Nothing from [01 §3](./01-normalized-field-catalog.md#3-explicitly-not-columns) leaked in as a column (`searchQuery`, `sortBy`, `background`, `CVC`, …)
- [ ] All 47 notification toggles are expressible as `NotificationSetting` rows
- [ ] All 13 buyer + 13 seller status labels map onto `OrderStatusBucket`

**Integrity**

- [ ] Every money field is `BigInt` minor units with an explicit currency — no `Float`, no `Decimal` for amounts
- [ ] Every timestamp is UTC; `Show.timezone` is the only stored zone and is display-only
- [ ] Soft delete present on: `User`, `Order`, `Listing`, `Collection`, `Review`, `Message`, `Conversation`, `Dispute`, `Story`, `Highlight`, `PaymentMethod`, `ShopPromotion`, both policies
- [ ] All 15 §15 `CHECK` constraints and 7 partial unique indexes are in the migration
- [ ] `SellerLedgerEntry` has the append-only trigger

**Concurrency** — the schema-level answers to CLAUDE.md's 20 questions

- [ ] Duplicate review → `@@unique([orderId, authorId, type])`
- [ ] Duplicate message on retry → `@@unique([conversationId, clientMessageId])`
- [ ] Duplicate thread on double-tap → partial unique on `Conversation`
- [ ] Double credit from a replayed webhook → `@@unique` on `SellerLedgerEntry.idempotencyKey`
- [ ] Duplicate promo redemption → `@@unique([promotionId, orderId])` **and** the transactional count
- [ ] Two open disputes → partial unique on `Dispute.orderId`
- [ ] Two default addresses → partial unique on `Address`
- [ ] Order number collision → Postgres sequence, not app-side generation

**Performance**

- [ ] Every list screen has a covering index (01 §8.5)
- [ ] Buyer-facing lists use cursor pagination — `page`/`totalPages` are not in the schema
- [ ] The notification fan-out index `(channel, type, enabled)` exists
- [ ] GIN / trigram / FTS / geo indexes stay in [`prisma/sql/performance.sql`](../prisma/sql/performance.sql), not here

**Open items — answer before migrating** (detail in [01 §9](./01-normalized-field-catalog.md#9-open-questions--product-decisions-needed-before-the-migration))

- [ ] Fold `Product` into `Listing`? *(recommended: yes)*
- [ ] Multi-seller cart → one order per seller, or parent/child? *(recommended: per seller)*
- [ ] Guest checkout on web? *(assumed **no** — if yes, `Order.customerId` must become nullable)*
- [ ] Story comments in scope for v1? *(if no, drop `StoryComment` + `commentCount`)*
- [ ] Single-currency at launch? *(`SellerBalance` assumes one currency per seller)*
- [ ] `sellerRank` formula
- [ ] Express shipping — per listing *(modeled)* or per shop?
- [ ] `usesPerPerson` — lifetime *(assumed)* or per period?
- [ ] Review edit window
- [ ] Notification pause — all channels *(modeled)* or push only?
- [ ] Referential-integrity option A / B / C (§16)

---

## 18. Model inventory

| Domain | Models | New |
|---|---|---|
| Identity & auth | `User`, `UserPermission`, `IdpLink`, `Credential`, `EmailToken`, `Address`, `SearchHistory` | 1 |
| Seller identity | `SellerProfile`, `SellerOnboarding`, `SellerApplication`, `SellerStats`, `ConsentRecord` | 5 |
| Policies | `ShippingPolicy`, `ReturnPolicy` | 2 |
| Catalog | `Category`, `Listing`, `ListingShippingOption`, `ListingImage`, `ListingMedia`, `ListingVariant`, `ListingStats`, `Collection`, `CollectionListing`, `Product` | 1 |
| Orders | `ProcessDef`, `Order`, `OrderTransition`, `LineItem`, `StockReservation`, `ScheduledTransition`, `CartItem`, `Review`, `ReviewImage` | 1 |
| Disputes | `Dispute`, `DisputeEvidence` | 2 |
| Messaging | `Conversation`, `Message`, `MessageAttachment` | 2 |
| Payments | `StripeAccount`, `StripeCustomer`, `PaymentMethod`, `PaymentIntent`, `Payout`, `Refund`, `StripeEvent`, `SellerBalance`, `SellerLedgerEntry` | 2 |
| Tax & shipping | `TaxOrder`, `TaxRefund`, `Shipment`, `TrackingEntry` | 0 |
| Social | `Follow`, `Favorite`, `Story`, `StoryLike`, `StoryComment`, `Highlight`, `HighlightStory`, `Show`, `ShowSession` | 1 |
| Notifications | `Notification`, `NotificationPreference`, `NotificationSetting`, `PushToken`, `OrderEmailReminder` | 1 |
| Promotions & config | `Discount`, `DiscountUsage`, `ShopPromotion`, `ShopPromotionUsage`, `CommissionConfig`, `ConfigAsset`, `CmsPage` | 0 |
| Analytics | `AnalyticsDaily`, `SellerAnalyticsDaily` | 1 |
| Admin & platform | `MediaAsset`, `AuditLog`, `AdminMembership`, `ImpersonationSession`, `FeatureFlag`, `RestrictionAppeal`, `UserRestriction`, `ContentReport`, `AccountDeletionRequest`, `Waitlist`, `Outbox`, `IdempotencyKey`, `NativeLog`, `DeviceBundle` | 3 |
| **Total** | **88** | **22** |

Build order and per-phase dependencies: [01 §10](./01-normalized-field-catalog.md#10-suggested-build-order).
