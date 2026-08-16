# 01 — Normalized Field Catalog (Buyer · Seller · Web · Admin)

| | |
|---|---|
| **Source** | [`datafields_Get_from_mobile_app_Design.md`](./datafields_Get_from_mobile_app_Design.md) — raw screen-by-screen field dump from Figma |
| **Purpose** | Convert screen fields into **entity fields** that can be written straight into `prisma/schema.prisma` |
| **Compared against** | [`prisma/schema.prisma`](../prisma/schema.prisma) (77 models) and [`Development/02-data-model.md`](../Development/02-data-model.md) |
| **Status** | Draft v1 — for review before schema work starts |

---

## 0. How to read this document

The raw file lists fields **per screen**. That is the wrong shape for a database: `productPrice` appears
on 14 screens, `sellerId` on 21, and roughly a third of the entries are not data at all (`searchQuery`,
`sortBy`, `saveChanges`, `background`, `text`, `border`). Feeding that list into Prisma would produce
duplicated columns, denormalized read-models masquerading as tables, and UI state stored in Postgres.

So this document flips the axis: **entity → fields**, with a surface matrix recording *which app reads
or writes each field*. Everything from the raw dump is accounted for — either as a column, as a derived
value, or in the explicit "not a column" list (§3).

### Surface legend

| Code | Surface |
|---|---|
| **BM** | Buyer Mobile (Expo — buyer mode) |
| **SM** | Seller Mobile (Expo — seller mode / "Seller app") |
| **WEB** | Web marketplace (React) |
| **ADM** | Admin / operator tools |

Cell values: `R` read · `W` write · `RW` read+write · `—` not used.

### Field-status legend

| Mark | Meaning |
|---|---|
| ✅ | Column already exists in `prisma/schema.prisma` — no change |
| ➕ | **New column** on an existing model |
| 🆕 | **New model** — does not exist today |
| 🔄 | Existing column needs a **type/semantics change** |
| ⚠️ | **Breaking change** — needs a data migration, not just `prisma migrate dev` |
| 🧮 | Derived at read time — **not stored** (listed for traceability only) |

### Type conventions (per [CLAUDE.md](../CLAUDE.md) §1)

| Concept | Prisma type | Notes |
|---|---|---|
| Primary key | `String @id @default(uuid(7)) @db.Uuid` | time-ordered UUIDv7, matches existing schema |
| Money | `BigInt` (minor units) + `String @db.Char(3)` currency | **never** `Float`/`Decimal` for amounts |
| Percentage | `Decimal @db.Decimal(5,2)` | commission, discount % |
| Timestamp | `DateTime` | **always UTC**; convert at presentation only |
| Soft delete | `deletedAt DateTime?` | users, orders, payments, listings, disputes, policies |
| Free-form tail | `Json @default("{}")` | only for genuinely open-ended data, never for filterable fields |
| Enum | Prisma `enum` | camelCase values, matching the majority of the existing schema |

> **Enum naming inconsistency (flag).** The current schema mixes camelCase (`ListingState.pendingApproval`,
> `StockType.oneItem`) with snake_case (`OrderProcess.instant_purchase`, `LineItemCode.shipping_fee`).
> All new enums in this document use **camelCase**. Standardizing the existing snake_case ones is a
> separate, optional cleanup — it is `@map`-able and not urgent.

---

## 1. Normalization rules applied

1. **One field, one home.** `productPrice`, `price`, `Product price`, `productPrice` (seller) → a single
   `Listing.priceAmount` + `Listing.priceCurrency`. The 40+ screen-level aliases collapse to ~1 column each
   (§2 records every alias so nothing is silently lost).
2. **Screen state is not schema.** Query params (`searchQuery`, `sortBy`, `page`, `totalPages`), local
   selection (`isSelected`, `selectedProductIds`), wizard flags (`isReady`, `unsavedChanges`), and design
   tokens (`semantic`, `background`, `text`, `border`) are excluded and listed in §3.
3. **Counts and rollups are derived or denormalized counters — never authored fields.** `productCount`,
   `unreadCount`, `averageRating`, `ratingDistribution`, `queuePosition`, `conversionRate` are computed;
   the hot ones get a counter column maintained by the owning service (§4).
4. **Money never stored as a total on a screen.** `Item subtotal`, `Sales tax`, `Shipping cost`, `Total`
   are **`LineItem` rows**, with `Order.payinTotalAmount` / `payoutTotalAmount` as the persisted snapshot.
   The pricing engine is server-authoritative (doc 04).
5. **Buyer/seller status labels are presentation, not state.** The design's two status vocabularies
   (`Buyer Status` / `Seller Status`) map onto **one** canonical FSM state — see §7.3.
6. **Address is one entity, typed.** `Shipping address`, `Billing address`, `shopAddress`, `sellerAddress`,
   `shippingOrigin`, `Street address / Apt / City / State / ZIP / Country` all resolve to `Address` rows
   discriminated by `Address.type`.
7. **Policies are entities, not strings.** `shippingPolicyId`, `returnPolicyId`, `returnPolicy`,
   `exchangePolicy`, `returnWindow`, `buyerPaysReturnShipping` become two owned, versioned models.
8. **Any field a screen filters or sorts by is a real column, never JSONB.** JSONB stays for the
   Sharetribe long tail only.

---

## 2. Alias resolution (design name → canonical field)

Every distinct name in the raw dump, resolved. Grouped by target entity.

### 2.1 User / profile

| Design name(s) | Canonical | Status |
|---|---|---|
| `Email`, `Email address`, `contactEmail`, `email` | `User.email` | ✅ |
| `Password`, `New password`, `Current password`, `Confirm Password` | `Credential` / DTO-only (`passwordHash`) | ✅ |
| `Keep me signed in` | *not a column* — controls refresh-token TTL | §3 |
| `Terms & Privacy Agreement` | `User.termsAcceptedAt` + `termsVersion` + `privacyAcceptedAt` + `privacyVersion` | ➕ |
| `First Name`, `firstName` | `User.firstName` | ✅ |
| `Last Name`, `lastName` | `User.lastName` | ✅ |
| `Profile photo`, `sellerAvatar`, `buyerAvatar`, `reviewerAvatar` | `User.profileImageId` → `MediaAsset` | ✅ |
| `About`, `bio` | `User.bio` | ✅ |
| `aboutShop`, `about` | `SellerProfile.about` | 🆕 |
| `Phone number`, `phoneNumber` | `User.phone` + `phoneVerifiedAt` | ➕ |
| `sellerName`, `buyerName`, `reviewerName`, `Seller`, `Seller owner` | `User.displayName` | ✅ |
| `sellerId`, `buyerId`, `userId`, `reporterId`, `senderId`, `receiverId`, `reviewerId` | FK → `User.id` | ✅ |
| `location` | `Address` (type `shop`) → city/state/country | ✅ |
| `joinedAt` | `User.createdAt` | ✅ |
| `socialLinks`, `Website/social link`, `website` | `SellerProfile.website` + `SellerProfile.socialLinks Json` | 🆕 |
| `Delete reason/confirmation` | `AccountDeletionRequest.reason` | ➕ |

### 2.2 Listing / product

| Design name(s) | Canonical | Status |
|---|---|---|
| `Product`, `productId`, `itemId`, `listingId` | `Listing.id` | ✅ |
| `productName`, `itemName`, `title` | `Listing.title` | ✅ |
| `description` | `Listing.description` | ✅ |
| `sellerNote` | `Listing.sellerNote` | ➕ |
| `Product price`, `productPrice`, `itemPrice`, `price` | `Listing.priceAmount` + `priceCurrency` | ✅ |
| `Product discount` | `Listing.originalPriceAmount` (strike-through source) | ✅ 🧮 |
| `productImage`, `productImages`, `itemImage` | `ListingImage[]` → `MediaAsset` | ✅ |
| `coverImage` | `Listing.coverImageId` | ➕ |
| `categoryId`, `category`, `Categories` | `Listing.categoryL1/L2/L3` + `Category` | ✅ |
| `quantity`, `stockQuantity` | `Listing.stockQuantity` | ✅ |
| `materials` | `Listing.materials String[]` | ✅ |
| `era`, `ageEra`, `period` | `Listing.period` | ✅ |
| `origin` | `Listing.origin` | ✅ |
| `certificateOfAuthenticity`, `certificationPhoto`, `certificationUrl` | `Listing.certificationAssetId` + `certificationUrl` | 🔄 (today: `certification String?`) |
| `length`, `width`, `height`, `dimensionUnit` | `Listing.itemLength/Width/Height` + `itemDimensionUnit` | ➕ |
| `weight`, `weightUnit` | `Listing.itemWeight` + `itemWeightUnit` | ➕ |
| `packageLength/Width/Height`, `packageDimensionUnit` | `Listing.packageLength/Width/Height` + `packageDimensionUnit` | ➕ |
| `packageWeight`, `packageWeightUnit` | `Listing.packageWeight` + `packageWeightUnit` | ➕ |
| `status`, `isDraft`, `isActive`, `productStatus` | `Listing.state` (`ListingState`) | ✅ |
| `isNew` | 🧮 `createdAt > now() - 14d` | 🧮 |
| `isAvailable` | 🧮 `state = published AND stockQuantity > 0` | 🧮 |
| `isFavorite`, `Favourite status` | 🧮 `EXISTS(Favorite WHERE userId = viewer)` | 🧮 |
| `sellerAddress`, `shippingOrigin` | `Listing.shipFromAddressId` → `Address(type: shipFrom)` | ➕ |

### 2.3 Shipping

| Design name(s) | Canonical | Status |
|---|---|---|
| `shippingMethod`, `shippingType`, `Shipping method` | `Listing.shippingMethod` (`ShippingMethod` enum) | 🔄 (today: `shippingType String?`) |
| `shippingPrice`, `standardShippingPrice`, `shipOneItemAmount` | `ListingShippingOption(tier: standard).priceAmount` | 🆕 |
| `fastShippingPrice`, `expressShippingPrice` | `ListingShippingOption(tier: express).priceAmount` | 🆕 |
| `shippingDiscountPerItem`, `discountPerExtraItem`, `shipAddlItemAmount` | `ListingShippingOption.extraItemAdjustmentAmount` | 🆕 |
| `carrierTransitTime`, `shippingDeliveryTime` | `ListingShippingOption.transitMinDays` / `transitMaxDays` | 🆕 |
| `handlingTime`, `orderHandlingTime` | `Listing.handlingTimeDays` + `SellerProfile.defaultHandlingTimeDays` | ➕ |
| `estimatedDelivery`, `Expected delivery date` | 🧮 `shippedAt|paidAt + handlingTime + transitDays`; snapshot on `Order.estimatedDeliveryAt` | ➕ 🧮 |
| `shippingRates` | Shippo response — `Shipment.shippoRateId` / cached, not a column | ✅ |
| `Shipping cost` | `LineItem(code: shipping_fee)` | ✅ |
| `Tracking number`, `trackingNumber`, `Tracking status` | `TrackingEntry.trackingId` / `.status` | ✅ / ➕ |
| `shippingPolicyId`, `Shipping & returns policy`, `shippingPolicy` | `ShippingPolicy.id` | 🆕 |
| `returnPolicyId`, `returnPolicy`, `exchangePolicy`, `Policy name` | `ReturnPolicy.id` | 🆕 |
| `returnWindow`, `Return period` | `ReturnPolicy.returnWindowDays` | 🆕 |
| `Return conditions` | `ReturnPolicy.conditions` | 🆕 |
| `Return shipping responsibility`, `buyerPaysReturnShipping` | `ReturnPolicy.returnShippingPaidBy` (`buyer`\|`seller`) | 🆕 |
| `exchangeAccepted` | `ReturnPolicy.exchangeAccepted` | 🆕 |
| `Policy status` | `ReturnPolicy.isActive` | 🆕 |

### 2.4 Order

| Design name(s) | Canonical | Status |
|---|---|---|
| `Order ID`, `Order number`, `orderNumber`, `orderId` | `Order.id` (UUID, internal) + `Order.orderNumber` (human-readable, unique) | ➕ |
| `Order status`, `orderStatus`, `status` | `Order.state` + `Order.statusBucket` (indexable filter) | ➕ |
| `Order date`, `orderDate` | `Order.createdAt` | ✅ |
| `shippingDate` | `Order.shippedAt` | ➕ |
| `Order activity`, `Order activity timestamp` | `OrderTransition` rows | ✅ |
| `Item subtotal`, `Sales tax`, `Shipping cost`, `Total`, `paymentAmount`, `totalAmount` | `LineItem` rows + `Order.payinTotalAmount` | ✅ |
| `platformFee` | `LineItem(code: provider_commission \| customer_commission)` | ✅ |
| `localSalesTaxes` | `LineItem(code: sales_tax)` + `TaxOrder` | ✅ |
| `Seller message` (checkout note) | `Order.buyerNote` | ➕ |
| `refundStatus` | `Order.refundStatus` (denorm from `Refund`) | ➕ |
| `cancellationReason` | `Order.cancellationReason` + `canceledAt` + `canceledByUserId` | ➕ |
| `Promo code` | `Order.discountCode` snapshot + `DiscountUsage` / `ShopPromotionUsage` | ➕ |
| `Payment method`, `Card details` | `PaymentMethod` (see §2.6) | ✅ |
| `Shipping address` | `Order.shippingAddress Json` snapshot | ✅ |

### 2.5 Messaging

| Design name(s) | Canonical | Status |
|---|---|---|
| `conversationId` | `Conversation.id` | 🆕 |
| `Message/Order tab`, `messageType` | `Conversation.kind` (`product`\|`order`) | 🆕 |
| `Message`, `message`, `lastMessage`, `Order message` | `Message.body` / `Conversation.lastMessagePreview` | 🔄 ⚠️ |
| `Message timestamp`, `createdAt`, `lastMessageAt` | `Message.createdAt` / `Conversation.lastMessageAt` | ✅ / 🆕 |
| `Message sender`, `senderId` | `Message.senderId` | ✅ |
| `Message delivery/read status`, `messageStatus` | `Message.deliveredAt` + `Message.readAt` | ➕ |
| `Unread status`, `unreadCount` | `Conversation.buyerUnreadCount` / `sellerUnreadCount` | 🆕 |
| `attachments` | `MessageAttachment[]` | 🆕 |

### 2.6 Payments

| Design name(s) | Canonical | Status |
|---|---|---|
| `Card brand`, `Card last 4 digits`, `Card expiry date` | `PaymentMethod.brand` / `.last4` / `.expMonth` `.expYear` | ✅ |
| `Card number`, `Expiry date`, `CVC` | **Never stored** — Stripe Elements/PaymentSheet only | §3 |
| `Cardholder name` | `PaymentMethod.cardholderName` | ➕ |
| `Primary card status` | 🧮 `StripeCustomer.defaultPaymentMethodId == pm.id` | 🧮 |
| `Billing address` | `PaymentMethod.billingAddress Json` (Stripe-mirrored) | ➕ |
| `Payment wallet` | `PaymentMethod.type` (`card`\|`applePay`\|`googlePay`\|`link`) | ➕ |
| `payoutAccount`, `Bank account type/country/last 4 digits` | `StripeAccount.externalAccountType` / `.country` / `.externalLast4` | ➕ / ✅ |
| `Payout account status`, `stripeAccountStatus`, `payoutStatus` | `StripeAccount.status` / `Payout.status` | ✅ |
| `stripeAccountId` | `StripeAccount.stripeAccountId` | ✅ |
| `totalEarnings`, `pendingAmount`, `availableAmount` | `SellerBalance.*` (ledger-backed) | 🆕 |
| `payoutHistory`, `orderEarnings` | `SellerLedgerEntry[]` / `Payout[]` | 🆕 / ✅ |

### 2.7 Social, stories, shows

| Design name(s) | Canonical | Status |
|---|---|---|
| `storyId`, `story` | `Story.id` | ✅ |
| `storyMedia`, `media`, `mediaType` | `Story.mediaUrl` + `Story.mediaType` | ✅ |
| `storyText`, `caption` | `Story.description` | ✅ |
| `taggedProduct` | `Story.listingId` | ✅ |
| `likeCount`, `isLiked` | `Story.likeCount` / 🧮 `StoryLike` | ✅ / 🧮 |
| `commentCount` | `Story.commentCount` + `StoryComment` | ➕ / 🆕 |
| `shareCount` | `Story.shareCount` | ➕ |
| `keepAfter24Hours` | `Story.expiresAt = null` (+ `Story.keepAfterExpiry`) | ➕ |
| `saveToHighlight`, `highlight`, `highlightId` | `HighlightStory` / `Highlight.id` | ✅ |
| `highlightName` | `Highlight.name` | ✅ |
| `coverStoryId` | `Highlight.coverStoryId` | ✅ |
| `storyIds`, `selectedStoryIds`, `storyOrder` | `HighlightStory.storyId` + `.position` | ✅ |
| `isPublished` (highlight) | `Highlight.isPublished` | ➕ |
| `postedAt`, `status` (story) | `Story.postedAt` + `Story.status` | ➕ |
| `showTitle` | `Show.title` | ✅ |
| `description` (show) | `Show.description` | ➕ |
| `startType`, `startDate`, `startTime`, `timezone` | `Show.startMode` + `Show.scheduledAt` (UTC) + `Show.timezone` | ➕ |
| `setEndTime`, `endDate`, `endTime` | `Show.scheduledEndAt` | ➕ |
| `products`, `productSelection` | `Show.productIds` | ✅ |
| `showOptions` | `Show.options Json` | ➕ |
| `followerCount`, `followingCount`, `totalFollowers` | `User.followersCount` / `followingCount` | ✅ |

### 2.8 Collections, reviews, reports, search

| Design name(s) | Canonical | Status |
|---|---|---|
| `collectionId`, `collectionName` | `Collection.id` / `.name` | ✅ |
| `collectionImage`, `collectionImages` | `Collection.coverAssetId` | ➕ |
| `collectionType` | `Collection.type` (`seller`\|`buyerSaved`) | ➕ |
| `productIds`, `productOrder` | `CollectionListing.listingId` + `.position` | ✅ |
| `itemCount`, `productCount`, `collectionItemCount` | `Collection.listingCount` (counter) | ➕ |
| `reviewId`, `rating`, `reviewText` | `Review.id` / `.rating` / `.content` | ✅ |
| `reviewImages` | `ReviewImage[]` | 🆕 |
| `sellerResponse` | `Review.responseBody` + `.respondedAt` | ➕ |
| `isVerifiedPurchase` | 🧮 `Review.orderId IS NOT NULL` | 🧮 |
| `averageRating`, `ratingDistribution` | `SellerStats.ratingAvg` + `.rating1..rating5` | 🆕 |
| `sellerRating`, `sellerRank`, `totalSales` | `SellerStats.ratingAvg` / `.rank` / `.grossSalesAmount` | 🆕 |
| `reason`, `description`, `evidence`, `evidenceType`, `sourceUrl` (report) | `ContentReport.reason` / `.details` / `.evidenceAssetId` / `.evidenceType` / `.sourceUrl` | ✅ / ➕ |
| `reportStatus` | `ContentReport.status` | ✅ |
| `Recent searches` | `SearchHistory` | 🆕 |
| `Popular categories`, `Search suggestions`, `Related categories`, `Related shops` | 🧮 search-engine / analytics output | 🧮 |

---

## 3. Explicitly NOT columns

These appear in the raw dump. **None of them becomes a database field.** Recorded so nobody
"finds a missing field" later and adds it.

### 3.1 Request / query parameters (DTO only)

`Search query` · `searchQuery` · `search` · `Sort/filter` · `sortBy` · `page` · `totalPages` ·
`View type` · `Message/Order tab` · `dateRange` · `Order status filter`

→ These belong in query DTOs and the cursor-pagination helpers in [`src/common/pagination/`](../src/common/pagination/).
`page`/`totalPages` in particular must **not** drive the API: buyer-facing lists use **cursor** pagination
(`perPage`, `count`, `nextCursor`, `hasNext`, `hasPrevious`) per CLAUDE.md §8. Offset paging is admin-only.

### 3.2 Local UI / wizard state

`isSelected` · `selectedProductIds` · `selectedStoryIds` · `isReady` · `unsavedChanges` · `saveChanges` ·
`discardChanges` · `leaveWithoutSaving` · `Cancel` · `Delete confirmation` · `Delete account` (button) ·
`Card removal confirmation` · `Account deletion acknowledgement` · `Cart status` · `Keep me signed in` ·
`Confirm Password` · `productSelection`

> `selectedProductIds` / `selectedStoryIds` / `storyOrder` are **request payloads** that persist as
> `CollectionListing` / `HighlightStory` rows — they are not columns on the parent.

### 3.3 Design tokens

`semantic` · `background` · `text` · `border` (from the `Order Status` block) — these are chip styling,
resolved client-side from the canonical status (§7.3). The backend returns the **state**, never a color.

### 3.4 Never persist (PCI / security)

`Card number` · `Expiry date` (raw) · `CVC` · `Password` (plaintext)

→ Card data goes **directly** to Stripe from the client (PaymentSheet / Elements). The backend only ever
sees and stores the Stripe PaymentMethod id, brand, last4, and expiry. Passwords are Argon2id hashes only.
The "Add Card" / "Edit Card" screens are Stripe-hosted flows; the backend exposes a SetupIntent, not a
card-fields endpoint.

### 3.5 Static content

`Terms and conditions` · `Privacy policy` · `Contact us` · `Log out` · `My orders` · `Payment options` ·
`Account settings` · `Seller app` · `Email preferences` · `Listing fees` · `Time to list` · `Payout speed`

→ Navigation entries and marketing copy. Legal/marketing bodies live in the existing `CmsPage` model;
`Listing fees` / `Time to list` / `Payout speed` on the "Become a Seller Approved" screen are static
value-prop copy driven by `ConfigAsset`.

---

## 4. Derived fields (computed, not authored)

Split into **counters** (denormalized column, maintained transactionally by the owning service) and
**pure reads** (computed per request, never stored).

### 4.1 Denormalized counters — a column, but never client-writable

| Field | Home | Maintained by |
|---|---|---|
| `followersCount`, `followingCount` | `User` ✅ | follow/unfollow tx |
| `favoriteCount`, `viewCount`, `ratingAvg`, `reviewCount` | `ListingStats` ✅ | favorite tx / view worker / review tx |
| `listingCount`, `ratingAvg`, `rating1..5`, `grossSalesAmount`, `orderCount` | `SellerStats` 🆕 | listing publish / order-complete / review tx |
| `listingCount` (per collection) | `Collection.listingCount` ➕ | collection-membership tx |
| `buyerUnreadCount`, `sellerUnreadCount` | `Conversation` 🆕 | message send / mark-read tx |
| `likeCount`, `commentCount`, `shareCount` | `Story` ✅ / ➕ | like/comment/share tx |
| `usageCount`, `revenue`, `discountGiven`, `orderCount` | `ShopPromotion` ✅ / ➕ | promo-redemption tx |
| `pendingAmount`, `availableAmount` | `SellerBalance` 🆕 | **ledger entries only** — never a direct `UPDATE` |
| `referralCount` | `Waitlist` ✅ | referral tx |

> Per CLAUDE.md §3, every counter update is atomic SQL (`SET x = x + 1 WHERE …`), never
> read-modify-write, and lives in the same transaction as the fact it counts.

### 4.2 Pure reads — never stored

| Field | Computation |
|---|---|
| `isFavorite` | `EXISTS(SELECT 1 FROM Favorite WHERE userId = :viewer AND listingId = …)` — batch-loaded per page, never N+1 |
| `isLiked` | `EXISTS(StoryLike WHERE userId = :viewer …)` |
| `isNew` | `Listing.createdAt > now() - interval '14 days'` |
| `isAvailable` | `state = 'published' AND stockQuantity > 0` |
| `isVerifiedPurchase` | `Review.orderId IS NOT NULL` |
| `isDraft` / `isActive` | projection of `Listing.state` |
| `Primary card status` | `pm.id = StripeCustomer.defaultPaymentMethodId` |
| `Queue position` | `RANK() OVER (ORDER BY priority DESC, createdAt)` on `SellerApplication` |
| `ratingDistribution` | 5 counter columns on `SellerStats`, returned as an object |
| `Item subtotal` / `Sales tax` / `Total` | sum over `LineItem` by `code` |
| `estimatedDelivery` | `(shippedAt ?? paidAt) + handlingTimeDays + transitMin..MaxDays` |
| `conversionRate` | `orders / profileViews` from `SellerAnalyticsDaily` |
| `averageOrderValue` | `grossSalesAmount / orderCount` |
| `salesOverTime`, `topListings` | aggregate query over `SellerAnalyticsDaily` / `LineItem` |
| `Order status count`, `Order count`, `conversationCount`, `collectionCount`, `notificationCount` | `COUNT(*)` with the filter's index |
| `Related shops`, `Related categories`, `Search suggestions`, `Popular categories` | search/recommendation layer (doc 05) |
| `waitingForYourReview` | seller-side variant of `pendingReview` — true when the **seller** has not yet reviewed (§7.3) |

---

## 5. Entity catalog — DB-ready

Only the fields that change or are new are enumerated per model; `✅`-only models are referenced, not
repeated. `→` denotes a foreign key.

### 5.1 Identity & account

**`User`** (extend — ✅ exists)

| Field | Type | Null | Default / constraint | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `phone` | `String` | ✓ | E.164, validated | RW | RW | RW | R |
| ➕ `phoneVerifiedAt` | `DateTime` | ✓ | | R | R | R | R |
| ➕ `termsAcceptedAt` | `DateTime` | ✓ | set at signup | W | W | W | R |
| ➕ `termsVersion` | `String` | ✓ | e.g. `2026-05-01` | W | W | W | R |
| ➕ `privacyAcceptedAt` | `DateTime` | ✓ | | W | W | W | R |
| ➕ `privacyVersion` | `String` | ✓ | | W | W | W | R |
| ➕ `lastSeenAt` | `DateTime` | ✓ | throttled write (≤1/hour) | — | — | — | R |
| 🔄 `userType` | `UserType` | | **add `admin` value** ⚠️ | R | R | R | RW |

> `Terms & Privacy Agreement` is a legal record, not a checkbox. Storing the accepted **version** is what
> makes it defensible; a bare boolean is worthless the day the terms change.

**`Address`** (extend — ✅ exists)

| Field | Type | Null | Default / constraint | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `type` | `AddressType` | | `shipping` — see §7.1 | RW | RW | RW | R |
| ➕ `phone` | `String` | ✓ | required for carrier labels | RW | RW | RW | R |
| ➕ `deletedAt` | `DateTime` | ✓ | soft delete | W | W | W | R |
| ➕ `@@index([userId, type, isDefault])` | | | | | | | |
| ➕ partial `UNIQUE(userId, type) WHERE isDefault` | | | one default per type | | | | |

> The partial unique index is what actually prevents two "default shipping addresses". Application code
> alone will lose that race (CLAUDE.md §1, §3).

**`AccountDeletionRequest`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `reason` | `String` | ✓ | from the Delete Account screen | W | W | W | R |
| ➕ `reasonCode` | `String` | ✓ | enum-ish, for analytics | W | W | W | R |
| ➕ `handledByUserId` | `String @db.Uuid` | ✓ | admin actor | — | — | — | W |

**🆕 `SearchHistory`** — "Recent searches" (Empty Search Screen)

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | uuid(7) |
| `userId` | `String @db.Uuid` | | → `User` |
| `query` | `String` | | trimmed, ≤120 chars |
| `resultCount` | `Int` | ✓ | for "No results" analytics |
| `createdAt` | `DateTime` | | `now()` |
| | | | `@@unique([userId, query])` — re-search bumps `createdAt` (upsert), never duplicates |
| | | | `@@index([userId, createdAt(sort: Desc)])` |

Surfaces: BM `RW` · SM `—` · WEB `RW` · ADM `R`

> Retention: keep the newest 20 per user; a nightly sweep trims the tail. Unbounded per-user history is
> a slow leak.

### 5.2 Policies (new domain)

The design's "Return & Exchange Policy Modal", `shippingPolicyId`, `returnPolicyId`, `returnWindow`,
`exchangeAccepted`, and `buyerPaysReturnShipping` all point at reusable, seller-owned policy documents
attached to listings. Today they do not exist at all.

**🆕 `ShippingPolicy`**

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `sellerId` | `String @db.Uuid` | | → `User` |
| `name` | `String` | | "Standard domestic" |
| `handlingTimeDays` | `Int` | | 1–30 |
| `shipsFromAddressId` | `String @db.Uuid` | ✓ | → `Address(type: shipFrom)` |
| `shipsToCountries` | `String[]` | | ISO-3166-1 alpha-2 |
| `isDefault` | `Boolean` | | `false` |
| `isActive` | `Boolean` | | `true` |
| `createdAt` / `updatedAt` / `deletedAt` | | | soft delete — listings reference it |
| | | | `@@unique([sellerId, name])`, partial `UNIQUE(sellerId) WHERE isDefault` |

**🆕 `ReturnPolicy`**

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `sellerId` | `String @db.Uuid` | | → `User` |
| `name` | `String` | | `Policy name` |
| `acceptsReturns` | `Boolean` | | `true` |
| `returnWindowDays` | `Int` | ✓ | `Return period` — null when `acceptsReturns = false` |
| `exchangeAccepted` | `Boolean` | | `false` |
| `returnShippingPaidBy` | `ReturnShippingPayer` | | `buyer` \| `seller` |
| `conditions` | `String` | ✓ | `Return conditions` free text |
| `isDefault` / `isActive` | `Boolean` | | |
| `createdAt` / `updatedAt` / `deletedAt` | | | |
| | | | `CHECK (NOT acceptsReturns OR returnWindowDays IS NOT NULL)` |

Surfaces (both): BM `R` · SM `RW` · WEB `R` · ADM `R`

> **Snapshot rule.** A policy is *referenced* by a listing but **copied** onto the order at purchase
> (`Order.returnPolicySnapshot Json`). Editing a policy must never retroactively change the terms a
> buyer already agreed to. Same reasoning as `Order.shippingAddress` being a JSON snapshot today.

### 5.3 Seller profile, onboarding, application

**🆕 `SellerProfile`** — 1:1 with `User`. Everything on "Shop Settings" and "Business Information"
that does not belong on the generic user record.

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| `userId` | `String @id @db.Uuid` | | → `User`, cascade | R | RW | R | RW |
| `shopName` | `String` | | `@unique` | R | RW | R | RW |
| `slug` | `String` | | `@unique`, SEO URL | R | R | R | RW |
| `shopLogoId` | `String @db.Uuid` | ✓ | `shopPhoto` / `Shop logo` → `MediaAsset` | R | RW | R | R |
| `showNameOnShop` | `Boolean` | | `true` — show real first/last name | R | RW | R | R |
| `about` | `String` | ✓ | `aboutShop` / `about` | R | RW | R | R |
| `businessType` | `String` | ✓ | | — | RW | — | R |
| `businessDescription` | `String` | ✓ | | R | RW | R | R |
| `website` | `String` | ✓ | URL-validated | R | RW | R | R |
| `socialLinks` | `Json` | | `{}` — `{instagram, tiktok, x, …}` | R | RW | R | R |
| `shopEmail` | `String` | ✓ | public contact — distinct from `User.email` | R | RW | R | R |
| `shopPhone` | `String` | ✓ | | R | RW | R | R |
| `shopAddressId` | `String @db.Uuid` | ✓ | → `Address(type: shop)` | R | RW | R | R |
| `visibility` | `ShopVisibility` | | `public` \| `hidden` — `shopVisibility` | R | RW | R | RW |
| `defaultHandlingTimeDays` | `Int` | | `2` — `orderHandlingTime` | R | RW | R | R |
| `defaultShippingPolicyId` | `String @db.Uuid` | ✓ | | — | RW | — | R |
| `defaultReturnPolicyId` | `String @db.Uuid` | ✓ | | R | RW | R | R |
| `createdAt` / `updatedAt` | | | | | | | |

> **Why a separate model and not more columns on `User`?** `User` is already 30+ columns and is on the
> hot path of every authenticated request. Shop data is read on shop pages, written on one settings
> screen, and only ~10% of users have it. Splitting keeps the auth-path row narrow and lets the shop
> record carry its own uniqueness constraints (`shopName`, `slug`).

**🆕 `SellerOnboarding`** — the "Seller Setup Guide" checklist (`Shop setup status`,
`Payment details status`, `First item listing status`, `Seller setup status`).

| Field | Type | Null | Notes |
|---|---|---|---|
| `userId` | `String @id @db.Uuid` | | → `User` |
| `businessInfoCompletedAt` | `DateTime` | ✓ | |
| `policiesCompletedAt` | `DateTime` | ✓ | |
| `payoutSetupCompletedAt` | `DateTime` | ✓ | mirrors `StripeAccount.payoutsEnabled` |
| `firstListingCreatedAt` | `DateTime` | ✓ | |
| `completedAt` | `DateTime` | ✓ | set when all four are non-null |
| `updatedAt` | `DateTime` | | |

Surfaces: BM `—` · SM `R` · WEB `R` · ADM `R`

> Timestamps, not booleans — "when did they finish onboarding" is a question ops will ask, and a boolean
> cannot answer it.

**🆕 `SellerApplication`** — "Become a Seller Form / Waitlist / Approved". The existing `Waitlist` model
is an email-capture list; this is the actual application with a review workflow. Keep both, linked.

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | `Application ID` |
| `userId` | `String @db.Uuid` | ✓ | null if applied pre-signup |
| `waitlistId` | `String @db.Uuid` | ✓ | → `Waitlist` |
| `fullName` | `String` | | |
| `email` | `String` | | |
| `addressId` | `String @db.Uuid` | ✓ | → `Address` |
| `sellerType` | `String` | | `Seller type` — from `ConfigAsset` vocabulary |
| `sellingPlatforms` | `String[]` | | `Selling platforms` (multi-select) |
| `collectionSize` | `String` | ✓ | banded, e.g. `1-10`, `11-50` |
| `websiteOrSocialUrl` | `String` | ✓ | |
| `biggestChallenge` | `String` | ✓ | free text |
| `status` | `SellerApplicationStatus` | | §7.4 |
| `priority` | `Int` | | `0` — drives queue position |
| `onboardingBatch` | `String` | ✓ | `Onboarding batch` |
| `inviteStatus` | `InviteStatus` | | `notInvited` |
| `invitedAt` / `approvedAt` / `rejectedAt` | `DateTime` | ✓ | `Approval date` |
| `reviewedByUserId` | `String @db.Uuid` | ✓ | admin actor |
| `decisionNote` | `String` | ✓ | internal |
| `submittedAt` | `DateTime` | | `Application submission date` |
| `createdAt` / `updatedAt` | | | |
| | | | `@@unique([email])` — one live application per email |
| | | | `@@index([status, priority, submittedAt])` — the queue + `Queue position` rank |

Surfaces: BM `RW` (apply/track) · SM `R` · WEB `RW` · ADM `RW`

**🆕 `SellerStats`** — 1:1 with `User`, backs `sellerRating`, `ratingDistribution`, `productCount`,
`totalSales`, `sellerRank`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `userId` | `String @id @db.Uuid` | | |
| `listingCount` | `Int` | `0` | published only |
| `orderCount` | `Int` | `0` | completed only |
| `grossSalesAmount` | `BigInt` | `0` | + `currency Char(3)` |
| `ratingAvg` | `Float` | `0` | |
| `reviewCount` | `Int` | `0` | |
| `rating1`…`rating5` | `Int` | `0` | the histogram — `ratingDistribution` |
| `rank` | `Int?` | | `sellerRank`, recomputed by a nightly job |
| `updatedAt` | `DateTime` | | |

### 5.4 Catalog — `Listing`

**`Listing`** (extend — ✅ exists)

| Field | Type | Null | Default / constraint | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `slug` | `String` | ✓ | `@unique`, SEO (web) | R | R | R | RW |
| ➕ `coverImageId` | `String @db.Uuid` | ✓ | → `ListingImage` \| `MediaAsset` | R | RW | R | R |
| ➕ `sellerNote` | `String` | ✓ | ≤1000 chars | R | RW | R | R |
| ➕ `handlingTimeDays` | `Int` | ✓ | falls back to `SellerProfile.defaultHandlingTimeDays` | R | RW | R | R |
| ➕ `shippingMethod` | `ShippingMethod` | | `flat` — §7.2 | R | RW | R | R |
| ➕ `shipFromAddressId` | `String @db.Uuid` | ✓ | → `Address(type: shipFrom)` | — | RW | — | R |
| ➕ `shippingPolicyId` | `String @db.Uuid` | ✓ | → `ShippingPolicy` | R | RW | R | R |
| ➕ `returnPolicyId` | `String @db.Uuid` | ✓ | → `ReturnPolicy` | R | RW | R | R |
| ➕ `itemLength` `itemWidth` `itemHeight` | `Decimal @db.Decimal(10,2)` | ✓ | item dimensions | R | RW | R | R |
| ➕ `itemDimensionUnit` | `DimensionUnit` | ✓ | `in` \| `cm` | R | RW | R | R |
| ➕ `itemWeight` | `Decimal @db.Decimal(10,3)` | ✓ | | R | RW | R | R |
| ➕ `itemWeightUnit` | `WeightUnit` | ✓ | `oz` \| `lb` \| `g` \| `kg` | R | RW | R | R |
| ➕ `packageLength` `packageWidth` `packageHeight` | `Decimal @db.Decimal(10,2)` | ✓ | **required to buy a Shippo rate** | — | RW | — | R |
| ➕ `packageDimensionUnit` | `DimensionUnit` | ✓ | | — | RW | — | R |
| ➕ `packageWeight` | `Decimal @db.Decimal(10,3)` | ✓ | | — | RW | — | R |
| ➕ `packageWeightUnit` | `WeightUnit` | ✓ | | — | RW | — | R |
| ➕ `certificationAssetId` | `String @db.Uuid` | ✓ | `certificationPhoto` → `MediaAsset` | R | RW | R | R |
| ➕ `certificationUrl` | `String` | ✓ | | R | RW | R | R |
| ➕ `moderationStatus` | `ModerationStatus` | | `notReviewed` — §7.5 | — | R | — | RW |
| ➕ `moderationReason` | `String` | ✓ | shown to seller on rejection | — | R | — | RW |
| ➕ `reviewedByUserId` / `reviewedAt` | | ✓ | | — | — | — | RW |
| 🔄 `certification` | `String?` | | **drop** after backfill into the two fields above ⚠️ | | | | |
| 🔄 `shippingType` `shipOneItemAmount` `shipAddlItemAmount` `freeShipping` | | | **superseded** by `ListingShippingOption` ⚠️ | | | | |

New indexes: `@@index([shippingPolicyId])`, `@@index([returnPolicyId])`,
`@@index([moderationStatus, createdAt])` (admin queue), `@@unique([slug])`.

**🆕 `ListingShippingOption`** — replaces the three flat shipping columns, and is the only shape that
supports the design's standard **and** express tiers with per-tier transit times.

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `listingId` | `String @db.Uuid` | | → `Listing`, cascade |
| `tier` | `ShippingTier` | | `standard` \| `express` \| `pickup` |
| `priceAmount` | `BigInt` | | `0` = free shipping |
| `currency` | `String @db.Char(3)` | | |
| `extraItemAdjustmentAmount` | `BigInt` | | `discountPerExtraItem` — signed; negative = discount |
| `transitMinDays` | `Int` | ✓ | `carrierTransitTime` low bound |
| `transitMaxDays` | `Int` | ✓ | high bound |
| `isActive` | `Boolean` | | `true` |
| | | | `@@unique([listingId, tier])` |
| | | | `CHECK (transitMinDays IS NULL OR transitMaxDays >= transitMinDays)` |

Surfaces: BM `R` · SM `RW` · WEB `R` · ADM `R`

> The raw dump has `carrierTransitTime` listed **twice** on both "Normal Shipping" screens — that is the
> min/max pair rendered as "3–5 business days", which is why it is two columns here.

**`Collection`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `type` | `CollectionType` | | `seller` \| `buyerSaved` | RW | RW | RW | R |
| ➕ `coverAssetId` | `String @db.Uuid` | ✓ | `collectionImage` | R | RW | R | R |
| ➕ `slug` | `String` | ✓ | SEO, `@@unique([ownerId, slug])` | R | R | R | R |
| ➕ `listingCount` | `Int` | | `0` counter — `itemCount` | R | R | R | R |
| ➕ `position` | `Int` | | `0` — seller ordering | — | RW | — | — |
| ➕ `updatedAt` | `DateTime` | | | R | R | R | R |
| ➕ `deletedAt` | `DateTime` | ✓ | soft delete | W | W | W | R |
| | | | `@@unique([ownerId, name])` — "Add New Collection" must reject duplicates in the DB | | | | |

### 5.5 Messaging — the largest structural change ⚠️

Today: `Message { orderId (required), senderId, content, createdAt }`. The design needs **product
conversations that exist before any order** ("Message Seller", "Messages Screen" with `productId`), a
conversation list with `lastMessage` / `unreadCount`, delivery/read receipts, and attachments. None of
that is expressible on the current model.

**🆕 `Conversation`**

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | `conversationId` |
| `kind` | `ConversationKind` | | `product` \| `order` |
| `buyerId` | `String @db.Uuid` | | → `User` |
| `sellerId` | `String @db.Uuid` | | → `User` |
| `listingId` | `String @db.Uuid` | ✓ | set for `kind = product` |
| `orderId` | `String @db.Uuid` | ✓ | set for `kind = order` |
| `lastMessageId` | `String @db.Uuid` | ✓ | |
| `lastMessageAt` | `DateTime` | ✓ | list sort key |
| `lastMessagePreview` | `String` | ✓ | ≤160 chars, denormalized |
| `buyerUnreadCount` | `Int` | | `0` |
| `sellerUnreadCount` | `Int` | | `0` |
| `buyerLastReadAt` / `sellerLastReadAt` | `DateTime` | ✓ | |
| `buyerArchivedAt` / `sellerArchivedAt` | `DateTime` | ✓ | |
| `createdAt` / `updatedAt` / `deletedAt` | | | |
| | | | `@@unique([orderId])` — exactly one order thread |
| | | | partial `UNIQUE(buyerId, sellerId, listingId) WHERE kind = 'product'` |
| | | | `@@index([sellerId, lastMessageAt(sort: Desc)])`, `@@index([buyerId, lastMessageAt(sort: Desc)])` |

> The partial unique index is what makes "message seller" idempotent. Without it, two taps on
> **Message Seller** create two threads — the exact double-click race in CLAUDE.md §3.

**`Message`** (rework — ⚠️ breaking)

| Field | Type | Null | Notes |
|---|---|---|---|
| 🔄 `conversationId` | `String @db.Uuid` | | **replaces** `orderId` as the parent |
| ⚠️ `orderId` | | | **removed** — reachable via `Conversation.orderId` |
| `senderId` | `String @db.Uuid` | | ✅ |
| 🔄 `body` | `String` | ✓ | renamed from `content`; nullable when attachment-only |
| ➕ `kind` | `MessageKind` | | `text` \| `image` \| `system` |
| ➕ `deliveredAt` | `DateTime` | ✓ | `messageStatus` |
| ➕ `readAt` | `DateTime` | ✓ | `messageStatus` |
| ➕ `clientMessageId` | `String` | ✓ | client-generated — `@@unique([conversationId, clientMessageId])` for send-retry idempotency |
| ➕ `deletedAt` | `DateTime` | ✓ | |
| | | | `@@index([conversationId, createdAt])` |
| | | | `CHECK (body IS NOT NULL OR kind <> 'text')` |

**🆕 `MessageAttachment`**

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `messageId` | `String @db.Uuid` | | → `Message`, cascade |
| `assetId` | `String @db.Uuid` | | → `MediaAsset` |
| `position` | `Int` | | `0` |

Surfaces (all three): BM `RW` · SM `RW` · WEB `RW` · ADM `R` (moderation read-only)

**Migration path (⚠️):** for each distinct `Message.orderId`, create one `Conversation`
(`kind = order`, buyer/seller from `Order.customerId`/`providerId`), repoint messages, backfill
`lastMessage*` and unread counts, then drop `Message.orderId`. This must run as a backfill job, not
inside the migration.

### 5.6 Orders, shipping, disputes, reviews

**`Order`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `orderNumber` | `String` | | `@unique` — human-readable `PST-2K6H-4821` | R | R | R | R |
| ➕ `statusBucket` | `OrderStatusBucket` | | indexable filter — §7.3 | R | R | R | R |
| ➕ `buyerNote` | `String` | ✓ | `Seller message` at checkout | W | R | W | R |
| ➕ `discountCode` | `String` | ✓ | snapshot of the applied `Promo code` | R | R | R | R |
| ➕ `estimatedDeliveryAt` | `DateTime` | ✓ | snapshot at ship time | R | R | R | R |
| ➕ `shippedAt` | `DateTime` | ✓ | `shippingDate` | R | R | R | R |
| ➕ `deliveredAt` | `DateTime` | ✓ | | R | R | R | R |
| ➕ `completedAt` | `DateTime` | ✓ | escrow released / auto-complete | R | R | R | R |
| ➕ `canceledAt` | `DateTime` | ✓ | | R | R | R | R |
| ➕ `canceledByUserId` | `String @db.Uuid` | ✓ | | — | — | — | R |
| ➕ `cancellationReason` | `String` | ✓ | | R | R | R | R |
| ➕ `refundStatus` | `RefundStatus` | | `none` — denorm of `Refund` | R | R | R | R |
| ➕ `returnPolicySnapshot` | `Json` | ✓ | terms as agreed at purchase | R | R | R | R |
| ➕ `deletedAt` | `DateTime` | ✓ | soft delete (CLAUDE.md §1) | — | — | — | R |
| | | | `@@index([customerId, statusBucket, createdAt])` — My Orders + status chips | | | | |
| | | | `@@index([providerId, statusBucket, createdAt])` — seller Orders | | | | |

> `orderNumber` is generated from a Postgres sequence, **not** `Math.random()` in Node — the DB is the
> only place that can guarantee uniqueness under concurrent checkout. It is what every screen labels
> "Order ID"; the UUID stays internal.
>
> `statusBucket` is a denormalized projection of `state` written in the **same transaction** as every
> transition. The status-filter screen needs `COUNT(*) GROUP BY` over millions of rows — that cannot run
> against a free-form `state String` without an index it can actually use.

**`TrackingEntry`** (extend — ✅ exists)

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `carrier` | `String` | ✓ | |
| ➕ `status` | `String` | ✓ | `Tracking status` — carrier-normalized |
| ➕ `lastCheckedAt` | `DateTime` | ✓ | powers `trackingStoppedUpdating` alert |
| ➕ `createdAt` | `DateTime` | | |

**🆕 `Dispute`** — nothing models disputes today, yet 6 of the 13 order statuses in the design are
dispute states (`disputed`, `refundOffered`, `partiallyRefunded`, `disputeEscalated`, `disputeResolved`)
plus 4 notification types.

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `orderId` | `String @db.Uuid` | | → `Order` |
| `openedByUserId` | `String @db.Uuid` | | buyer or seller |
| `reason` | `String` | | vocabulary from `ConfigAsset` |
| `description` | `String` | ✓ | |
| `status` | `DisputeStatus` | | §7.6 |
| `offerAmount` | `BigInt` | ✓ | seller's `refundOffered` amount |
| `offerCurrency` | `String @db.Char(3)` | ✓ | |
| `offerExpiresAt` | `DateTime` | ✓ | |
| `resolution` | `DisputeResolution` | ✓ | `fullRefund` \| `partialRefund` \| `replacement` \| `released` |
| `resolvedByUserId` | `String @db.Uuid` | ✓ | admin on escalation |
| `escalatedAt` / `resolvedAt` | `DateTime` | ✓ | |
| `adminNote` | `String` | ✓ | internal only |
| `createdAt` / `updatedAt` / `deletedAt` | | | |
| | | | partial `UNIQUE(orderId) WHERE status NOT IN ('resolved','withdrawn')` — one open dispute per order |
| | | | `@@index([status, createdAt])` — admin queue |

**🆕 `DisputeEvidence`** — `id`, `disputeId`, `uploadedByUserId`, `assetId` → `MediaAsset`, `note`, `createdAt`.

Surfaces: BM `RW` · SM `RW` · WEB `RW` · ADM `RW`

**`Review`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `responseBody` | `String` | ✓ | `sellerResponse` | R | RW | R | R |
| ➕ `respondedAt` | `DateTime` | ✓ | | R | RW | R | R |
| ➕ `updatedAt` | `DateTime` | | edit window | | | | |
| ➕ `deletedAt` | `DateTime` | ✓ | moderation removal | — | — | — | W |
| | | | `@@unique([orderId, authorId, type])` — one review per author per order | | | | |

> The unique constraint is the review-integrity guarantee. Without it, a retried request or a
> double-tapped submit produces two 5-star reviews and silently corrupts `ratingAvg`.

**🆕 `ReviewImage`** — `id`, `reviewId` (cascade), `assetId` → `MediaAsset`, `position`.

### 5.7 Payments, payouts, earnings

**`PaymentMethod`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `type` | `PaymentMethodType` | | `card` \| `applePay` \| `googlePay` \| `link` | R | R | R | R |
| ➕ `cardholderName` | `String` | ✓ | | RW | — | RW | — |
| ➕ `billingAddress` | `Json` | ✓ | mirrored from Stripe, never authoritative | RW | — | RW | — |
| ➕ `deletedAt` | `DateTime` | ✓ | detach ≠ delete — orders reference it | W | — | W | R |

**`StripeAccount`** (extend — ✅ exists)

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `externalAccountType` | `String` | ✓ | `bank_account` \| `card` — `Bank account type` |
| ➕ `externalBankName` | `String` | ✓ | |
| ➕ `payoutsPausedAt` | `DateTime` | ✓ | admin action |

**🆕 `SellerBalance`** + **🆕 `SellerLedgerEntry`** — the "Earnings" screen
(`totalEarnings`, `pendingAmount`, `availableAmount`, `payoutHistory`, `orderEarnings`, `platformFee`,
`localSalesTaxes`, `payoutStatus`) currently has no home. Per CLAUDE.md §6, a balance is **never**
mutated directly — every change is a ledger entry, and the balance is the running total.

`SellerBalance`

| Field | Type | Default | Notes |
|---|---|---|---|
| `sellerId` | `String @id @db.Uuid` | | |
| `currency` | `String @db.Char(3)` | | |
| `pendingAmount` | `BigInt` | `0` | in escrow, not yet released |
| `availableAmount` | `BigInt` | `0` | released, payable |
| `lifetimeGrossAmount` | `BigInt` | `0` | `totalEarnings` |
| `lifetimeFeeAmount` | `BigInt` | `0` | `platformFee` total |
| `version` | `Int` | `0` | optimistic lock |
| `updatedAt` | `DateTime` | | |

`SellerLedgerEntry`

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `sellerId` | `String @db.Uuid` | | |
| `orderId` / `payoutId` / `refundId` | `String @db.Uuid` | ✓ | provenance |
| `type` | `LedgerEntryType` | | `sale` \| `platformFee` \| `salesTax` \| `refund` \| `payout` \| `adjustment` |
| `direction` | `LedgerDirection` | | `credit` \| `debit` |
| `amount` | `BigInt` | | always positive; `direction` carries the sign |
| `currency` | `String @db.Char(3)` | | |
| `pendingAfter` / `availableAfter` | `BigInt` | | running balances — makes reconciliation a `SELECT` |
| `idempotencyKey` | `String` | | `@unique` — **the** duplicate-credit guard |
| `occurredAt` / `createdAt` | `DateTime` | | |
| | | | `@@index([sellerId, occurredAt(sort: Desc)])` |

Surfaces: BM `—` · SM `R` · WEB `R` · ADM `RW` (adjustments only, always audited)

> Entries are **append-only**. No `UPDATE`, no `DELETE`, no soft delete. A correction is a new
> compensating entry. `idempotencyKey` (e.g. `payout:{payoutId}`, `sale:{orderId}`) is what makes a
> duplicated Stripe webhook a no-op instead of a double credit — CLAUDE.md §4 and §6.

### 5.8 Notifications & preferences

**`Notification`** (extend — ✅ exists)

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `category` | `NotificationCategory` | | `order` \| `message` \| `social` \| `live` \| `promotion` \| `dispute` \| `system` — `Notification category` |
| ➕ `title` | `String` | ✓ | server-rendered `Notification title` |
| ➕ `body` | `String` | ✓ | `Notification message` |
| ➕ `deepLink` | `String` | ✓ | resolves `Related order/product/message` |

**🔄 `NotificationPreference`** — today two opaque `Json` blobs (`priorities`, `enabled`). The design
specifies **47 distinct named toggles** across 4 screens (buyer push 13, buyer email 15, seller push 6,
seller email 13). Opaque JSON cannot be queried, so "who has `priceDrop` enabled" becomes a full scan of
every user — unusable for fan-out.

Replace with a row-per-toggle table:

**🆕 `NotificationSetting`**

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | `String @id @db.Uuid` | | |
| `userId` | `String @db.Uuid` | | |
| `mode` | `RecipientMode` | | `buyer` \| `seller` |
| `channel` | `NotificationChannel` | | `push` \| `email` \| `inApp` |
| `type` | `String` | | the toggle key — §7.7 |
| `enabled` | `Boolean` | | `true` |
| `updatedAt` | `DateTime` | | |
| | | | `@@unique([userId, mode, channel, type])` |
| | | | `@@index([channel, type, enabled])` — **the fan-out index** |

Plus on a retained, slimmed `NotificationPreference` (or `User`):

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `pausedUntil` | `DateTime` | ✓ | `Pause notifications` — null = not paused |
| ✅ `priorities` | `Json` | | keep — FCM channel priority, low cardinality, never filtered on |

Surfaces: BM `RW` · SM `RW` · WEB `RW` · ADM `R`

> Absent row = platform default. Only explicit user choices are written, so a new notification type ships
> without backfilling 34 rows × every user.

### 5.9 Stories, highlights, live shows

**`Story`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `status` | `StoryStatus` | | `draft` \| `posted` \| `expired` \| `archived` | R | RW | R | R |
| ➕ `postedAt` | `DateTime` | ✓ | | R | RW | R | R |
| ➕ `keepAfterExpiry` | `Boolean` | | `false` — `keepAfter24Hours` | — | RW | — | R |
| ➕ `commentCount` | `Int` | | `0` counter | R | R | R | R |
| ➕ `shareCount` | `Int` | | `0` counter | R | R | R | R |
| ➕ `deletedAt` | `DateTime` | ✓ | | — | W | — | W |

**🆕 `StoryComment`** — `id`, `storyId` (cascade), `authorId`, `body`, `createdAt`, `deletedAt`,
`@@index([storyId, createdAt])`.

**`Highlight`** (extend — ✅ exists)

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `isPublished` | `Boolean` | | `false` |
| ➕ `position` | `Int` | | `0` |
| ➕ `updatedAt` | `DateTime` | | |
| ➕ `deletedAt` | `DateTime` | ✓ | |
| | | | `@@unique([userId, name])` |

**`HighlightStory`** — ➕ add the missing `story Story @relation(...)` back-relation (today only
`highlight` is related, so `storyId` is an unenforced pointer — a FK the DB is not checking).

**`Show`** (extend — ✅ exists)

| Field | Type | Null | Notes | BM | SM | WEB | ADM |
|---|---|---|---|---|---|---|---|
| ➕ `description` | `String` | ✓ | | R | RW | R | R |
| ➕ `startMode` | `ShowStartMode` | | `now` \| `scheduled` — `startType` | — | RW | — | R |
| ➕ `timezone` | `String` | ✓ | IANA, e.g. `America/New_York` — **display only**, `scheduledAt` stays UTC | R | RW | R | R |
| ➕ `scheduledEndAt` | `DateTime` | ✓ | `setEndTime` + `endDate`/`endTime` | R | RW | R | R |
| ➕ `options` | `Json` | | `{}` — `showOptions` | — | RW | — | R |

> `startDate` + `startTime` + `timezone` are **three UI inputs for one instant**. They collapse to a
> single UTC `scheduledAt`; `timezone` is kept only so the seller sees the show back in the zone they
> scheduled it in. Storing local time would be the exact mistake CLAUDE.md §1 forbids.

### 5.10 Promotions

**`ShopPromotion`** (extend — ✅ exists)

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `startsAt` | `DateTime` | ✓ | `startDate` — currently only `expiresAt` exists |
| ➕ `discountType` | `DiscountType` | | `percentage` \| `fixedAmount` — design has **both** `discountAmount` and `discountPercentage` |
| ➕ `discountAmount` | `BigInt` | ✓ | required when `discountType = fixedAmount` |
| ➕ `currency` | `String @db.Char(3)` | ✓ | |
| ➕ `usesPerCustomer` | `Int` | ✓ | `usesPerPerson`; null = unlimited |
| ➕ `orderCount` | `Int` | | `0` counter |
| 🔄 `discountPercent` | `Decimal` | ✓ | now nullable — only for `percentage` |
| | | | `CHECK ((discountType='percentage' AND discountPercent IS NOT NULL) OR (discountType='fixedAmount' AND discountAmount IS NOT NULL))` |
| | | | `CHECK (expiresAt IS NULL OR startsAt IS NULL OR expiresAt > startsAt)` |

**`ShopPromotionUsage`** ⚠️ — `@@unique([userId, promotionId])` **must be dropped**: it hard-caps every
promotion at one use per customer, which contradicts `usesPerPerson`. Replace with:

- `@@unique([promotionId, orderId])` — idempotency (a retried checkout cannot double-count)
- `@@index([promotionId, userId])` — the per-customer limit is then enforced by a `COUNT` inside the
  checkout transaction, **against a row-locked promotion**, not by a blanket unique index.

The same correction applies to `DiscountUsage.@@unique([userId, discountId])`.

> This is a live coupon-abuse vector in both directions: the current index blocks legitimate repeat use,
> and removing it *without* the transactional count check would allow unlimited redemption.

### 5.11 Analytics

**🆕 `SellerAnalyticsDaily`** — the "Shop Analytics" screen (`totalSales`, `profileViews`, `orders`,
`conversionRate`, `averageOrderValue`, `salesOverTime`, `topListings`). `AnalyticsDaily` today is
platform-wide only.

| Field | Type | Default | Notes |
|---|---|---|---|
| `sellerId` | `String @db.Uuid` | | |
| `day` | `String` | | `YYYY-MM-DD` (UTC) |
| `profileViews` | `BigInt` | `0` | |
| `listingViews` | `BigInt` | `0` | |
| `orderCount` | `Int` | `0` | |
| `grossSalesAmount` | `BigInt` | `0` | + `currency` |
| `refundedAmount` | `BigInt` | `0` | |
| `favoritesAdded` | `Int` | `0` | |
| `followersGained` | `Int` | `0` | |
| | | | `@@id([sellerId, day])`, `@@index([day])` |

`conversionRate`, `averageOrderValue`, `salesOverTime`, `topListings` are all computed from this table
plus `LineItem` — none is a stored field.

Surfaces: BM `—` · SM `R` · WEB `R` · ADM `R`

### 5.12 Admin & moderation

The design file contains **zero admin screens**, so this section is derived from the workflows the buyer
and seller screens imply (report → moderate, apply → approve, dispute → escalate, delete → process) plus
CLAUDE.md §7/§9. Treat it as a proposal to confirm.

**`ContentReport`** (extend — ✅ exists) — "Report Listing Screen"

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `evidenceAssetId` | `String @db.Uuid` | ✓ | `evidence` → `MediaAsset` |
| ➕ `evidenceType` | `String` | ✓ | `screenshot` \| `link` \| `other` |
| ➕ `sourceUrl` | `String` | ✓ | |
| ➕ `assignedToUserId` | `String @db.Uuid` | ✓ | queue ownership |
| ➕ `resolution` | `String` | ✓ | |
| ➕ `reviewedByUserId` / `reviewedAt` | | ✓ | |
| ➕ `updatedAt` | `DateTime` | | |

**`AuditLog`** (extend — ✅ exists) — CLAUDE.md §9 requires *user ID, action, **old value**, **new
value**, timestamp, **IP**, **request ID***. Four of those seven are missing today.

| Field | Type | Null | Notes |
|---|---|---|---|
| ➕ `actorUserId` | `String @db.Uuid` | ✓ | typed FK alongside the existing free-text `actor` |
| ➕ `beforeValue` | `Json` | ✓ | |
| ➕ `afterValue` | `Json` | ✓ | |
| ➕ `ip` | `String` | ✓ | |
| ➕ `requestId` | `String` | ✓ | correlation id |
| ➕ `userAgent` | `String` | ✓ | |
| | | | `@@index([actorUserId, createdAt])` |

**🆕 `AdminMembership`** (+ `AdminRole` enum) — there is no admin identity today (`UserType` is
`customer` \| `seller` \| `provider`), yet every queue model above assumes an admin actor.

`AdminMembership`: `userId` (`@id`), `role AdminRole`, `grantedByUserId`, `grantedAt`, `revokedAt`,
`@@index([role, revokedAt])`, where
`enum AdminRole { superAdmin, opsAgent, moderator, financeAgent, support }`.

**🆕 `ImpersonationSession`** — the `loginAs` capability carried over from Sharetribe. Impersonation
without an audit trail is indefensible.

`id`, `adminUserId`, `targetUserId`, `reason`, `startedAt`, `endedAt`, `ip`, `requestId`,
`@@index([targetUserId, startedAt])`.

**🆕 `FeatureFlag`** — CLAUDE.md §11 requires large features to ship behind flags.

`key` (`@id`), `description`, `enabled`, `rolloutPercentage Int`, `enabledUserIds String[] @db.Uuid`,
`updatedByUserId`, `updatedAt`.

Surfaces (all four models): BM `—` · SM `—` · WEB `—` · ADM `RW`

---

## 6. Surface matrix

Entity-level ownership. `W` on a surface means that surface is a legitimate write origin — everything
else is a `403` enforced server-side (CLAUDE.md §7: never trust the client's idea of its own role).

| Entity | BM | SM | WEB | ADM | Write authority |
|---|---|---|---|---|---|
| `User` (own profile) | RW | RW | RW | RW | self, or admin with audit |
| `UserPermission`, `UserRestriction`, `AdminMembership` | — | — | — | RW | admin only |
| `Address` | RW | RW | RW | R | owner only |
| `SellerProfile`, `SellerOnboarding` | R | RW | R | RW | owner; admin may force `visibility` |
| `SellerApplication` | RW | R | RW | RW | applicant creates; admin decides |
| `SellerStats`, `SellerAnalyticsDaily` | — | R | R | R | **system only** |
| `ShippingPolicy`, `ReturnPolicy` | R | RW | R | R | owning seller |
| `Listing` | R | RW | R | RW | author; admin moderates |
| `ListingShippingOption` | R | RW | R | R | author |
| `Collection` (seller) | R | RW | R | R | owner |
| `Collection` (buyer saved) | RW | — | RW | — | owner |
| `Favorite`, `Follow`, `SearchHistory` | RW | RW | RW | R | self |
| `CartItem` | RW | — | RW | — | self |
| `Order` | RW | RW | RW | RW | FSM transitions only — never a direct field write |
| `LineItem` | R | R | R | R | **pricing engine only** — never client-writable |
| `Shipment`, `TrackingEntry` | R | RW | R | RW | seller/carrier webhook |
| `Dispute`, `DisputeEvidence` | RW | RW | RW | RW | party to the order; admin resolves escalations |
| `Review`, `ReviewImage` | RW | R | RW | RW | buyer authors; seller writes `responseBody` only |
| `Conversation`, `Message`, `MessageAttachment` | RW | RW | RW | R | participants only |
| `PaymentMethod` | RW | — | RW | R | self (via Stripe) |
| `StripeAccount`, `Payout` | — | RW | R | RW | self via Stripe; admin can pause |
| `SellerBalance`, `SellerLedgerEntry` | — | R | R | RW | **system**; admin adjustments only, audited |
| `Refund` | R | RW | R | RW | seller/admin, through the refund flow |
| `Story`, `StoryComment`, `Highlight` | R (+like/comment) | RW | R | RW | author; admin removes |
| `Show`, `ShowSession` | R | RW | R | RW | creator |
| `ShopPromotion` | R | RW | R | R | owning seller |
| `Discount` (platform-wide) | R | R | R | RW | admin only |
| `Notification` | R | R | R | RW | **system**; user writes `read` only |
| `NotificationSetting` | RW | RW | RW | R | self |
| `ContentReport` | W | W | W | RW | anyone reports; admin resolves |
| `AccountDeletionRequest` | W | W | W | RW | self requests; admin executes |
| `CmsPage`, `ConfigAsset`, `CommissionConfig`, `FeatureFlag` | R | R | R | RW | admin only |
| `AuditLog`, `ImpersonationSession` | — | — | — | R | **append-only, system-written** |

### 6.1 Surface-specific fields

| Surface | Fields it uniquely needs | Status |
|---|---|---|
| **WEB** | `Listing.slug`, `SellerProfile.slug`, `Collection.slug` (SEO URLs) | ➕ |
| **WEB** | `CmsPage` (Terms, Privacy, landing) | ✅ |
| **WEB** | Guest cart before login → `CartItem.sessionId String?` + merge-on-login | ➕ |
| **WEB** | Cookie/marketing consent → `ConsentRecord` | 🆕 (GDPR/CCPA) |
| **WEB/BM** | `Waitlist.referralToken`, `referralCount` | ✅ |
| **BM/SM** | `PushToken`, `DeviceBundle` (OTA) | ✅ |
| **SM** | `SellerOnboarding`, `SellerBalance`, `SellerAnalyticsDaily` | 🆕 |
| **ADM** | `AdminMembership`, `ImpersonationSession`, `FeatureFlag`, extended `AuditLog` | 🆕 / ➕ |

> **Web and buyer-mobile are the same domain model**, not two schemas. The only real deltas are SEO
> slugs, guest carts, and consent records. Anyone proposing a "web table" is proposing a bug.

---

## 7. Enum vocabulary

New enums, plus the canonical order-status mapping the design's two label sets collapse onto.

### 7.1 Address / shop

```
enum AddressType     { shipping, billing, shop, shipFrom, returnTo }
enum ShopVisibility  { public, hidden }
```

### 7.2 Catalog / shipping

```
enum ShippingMethod      { free, flat, calculated, custom, localPickup }
enum ShippingTier        { standard, express, pickup }
enum DimensionUnit       { in, cm }
enum WeightUnit          { oz, lb, g, kg }
enum CollectionType      { seller, buyerSaved }
enum ModerationStatus    { notReviewed, approved, rejected, flagged }
enum ReturnShippingPayer { buyer, seller }
```

### 7.3 Order status — one state, two vocabularies

The design lists a 12-value `Buyer Status` set and a 13-value `Seller Status` set. They are **not two
state machines**. They are two label sets over one FSM, and the single divergence
(`pendingReview` vs `waitingForYourReview`) is *derived*, not stored.

```
enum OrderStatusBucket {
  pendingPayment, preparingShipment, inTransit, delivered,
  pendingReview, completed, disputed, refundOffered,
  partiallyRefunded, refunded, disputeEscalated, disputeResolved, canceled
}
```

| `statusBucket` | Buyer label | Seller label |
|---|---|---|
| `pendingPayment` | *(hidden — transient)* | *(hidden)* |
| `preparingShipment` | Preparing shipment | Preparing shipment |
| `inTransit` | In transit | Shipped |
| `delivered` | Delivered | Delivered |
| `pendingReview` | Pending review | Pending review **or** Waiting for your review 🧮 |
| `completed` | Completed | Completed |
| `disputed` | Disputed | Disputed |
| `refundOffered` | Refund offered | Refund offered |
| `partiallyRefunded` | Partially refunded | Partially refunded |
| `refunded` | Refunded | Refunded |
| `disputeEscalated` | Dispute escalated | Dispute escalated |
| `disputeResolved` | Dispute resolved | Dispute resolved |
| `canceled` | Canceled | Canceled |

> 🧮 `Waiting for your review` is `pendingReview AND NOT EXISTS(Review WHERE authorId = seller AND
> orderId = …)`. The seller's extra 13th status is a query, not a column.
>
> `Order.state` remains the free-form FSM state driven by `ProcessDef` (there are more internal states
> than there are chips). `statusBucket` is the presentation projection, written in the same transaction.
> The API returns `statusBucket` + a localized label; it never returns `semantic`/`background`/`text`/
> `border` — those are client design tokens (§3.3).

```
enum RefundStatus { none, requested, partial, full }
```

### 7.4 Seller application

```
enum SellerApplicationStatus { submitted, waitlisted, underReview, approved, rejected, withdrawn }
enum InviteStatus            { notInvited, invited, accepted, expired }
```

### 7.5 Messaging / social

```
enum ConversationKind { product, order }
enum MessageKind      { text, image, system }
enum StoryStatus      { draft, posted, expired, archived }
enum ShowStartMode    { now, scheduled }
```

### 7.6 Disputes

```
enum DisputeStatus     { open, underReview, offerMade, escalated, resolved, withdrawn }
enum DisputeResolution { fullRefund, partialRefund, replacement, released }
```

### 7.7 Money / notifications

```
enum PaymentMethodType { card, applePay, googlePay, link }
enum LedgerEntryType   { sale, platformFee, salesTax, refund, payout, adjustment }
enum LedgerDirection   { credit, debit }
enum DiscountType      { percentage, fixedAmount }

enum RecipientMode         { buyer, seller }
enum NotificationChannel   { push, email, inApp }
enum NotificationCategory  { order, message, social, live, promotion, dispute, system }
```

**`NotificationSetting.type` vocabulary** — a `String` (not an enum) so a new notification type ships
without a migration; validated against this catalog at the DTO layer and seeded in `ConfigAsset`.

| Mode | Channel | Types |
|---|---|---|
| buyer | push | `orderConfirmed`, `orderShipped`, `orderDelivered`, `orderCancelled`, `disputeUpdates`, `newStory`, `newProduct`, `liveShowStarted`, `upcomingLiveReminder`, `priceDrop`, `almostGone`, `sellerReplies`, `offersAndPromotions` |
| buyer | email | `orderConfirmed`, `orderShipped`, `outForDelivery`, `delivered`, `paymentReceipt`, `refundIssued`, `partialRefundIssued`, `paymentIssue`, `leaveReview`, `sellerRepliedToReview`, `newMessageFromSeller`, `priceDropOnFavourite`, `backInStock`, `weeklyPicks`, `promotionsAndDiscountCodes` |
| seller | push | `newOrder`, `orderReceived`, `orderDisputed`, `disputeUnderReview`, `upcomingLiveReminder`, `newMessage` |
| seller | email | `payoutPending`, `paymentReleased`, `trackingStoppedUpdating`, `shipmentIssue`, `refundIssued`, `partialRefundIssued`, `orderDisputed`, `disputeUnderReview`, `leaveReview`, `reviewWaiting`, `reviewPublished`, `newMessage`, `newFollower` |

47 toggles total. `paymentReceipt`, `refundIssued`, `paymentIssue`, and `orderConfirmed` are
**transactional**, not marketing — they should be flagged non-disableable in the catalog regardless of
what the settings screen renders, or the platform ships without a receipt trail.

---

## 8. Change list against `prisma/schema.prisma`

Ordered by blast radius. ⚠️ = needs a backfill job, not just `prisma migrate dev`.

### 8.1 New models (22)

| Model | Domain | Why |
|---|---|---|
| `ShippingPolicy`, `ReturnPolicy` | catalog | `shippingPolicyId` / `returnPolicyId` / `returnWindow` referenced across 9 screens |
| `ListingShippingOption` | catalog | standard + express tiers with per-tier transit times |
| `SellerProfile` | seller | Shop Settings + Business Information (22 fields) |
| `SellerOnboarding` | seller | Seller Setup Guide checklist |
| `SellerApplication` | seller | Become a Seller form + waitlist + approval |
| `SellerStats` | seller | `sellerRating`, `ratingDistribution`, `productCount`, `totalSales`, `sellerRank` |
| `SellerAnalyticsDaily` | analytics | Shop Analytics screen |
| `SellerBalance`, `SellerLedgerEntry` | money | Earnings screen; CLAUDE.md §6 ledger requirement |
| `Conversation`, `MessageAttachment` | messaging | product conversations, unread counts, receipts |
| `Dispute`, `DisputeEvidence` | orders | 6 of 13 order statuses are dispute states |
| `ReviewImage` | reviews | `reviewImages` |
| `StoryComment` | social | `commentCount` |
| `NotificationSetting` | notifications | 47 named toggles; opaque JSON cannot be queried for fan-out |
| `SearchHistory` | discovery | Recent searches |
| `ConsentRecord` | web | cookie/marketing consent |
| `AdminMembership`, `ImpersonationSession`, `FeatureFlag` | admin | no admin identity exists today |

### 8.2 Breaking changes (5) ⚠️

| # | Change | Migration |
|---|---|---|
| 1 | `Message.orderId` → `Message.conversationId`; `content` → `body` | Create one `Conversation` per distinct `orderId`, repoint, backfill `lastMessage*` + unread counts, then drop the column. Backfill job. |
| 2 | Drop `ShopPromotionUsage.@@unique([userId, promotionId])` and `DiscountUsage.@@unique([userId, discountId])` | Replace with `@@unique([promotionId, orderId])` + a transactional per-customer `COUNT` under a row lock. **Do not drop one without adding the other** — that opens unlimited redemption. |
| 3 | `Listing.shippingType` / `shipOneItemAmount` / `shipAddlItemAmount` / `freeShipping` → `ListingShippingOption` | Backfill one `standard` row per listing, then drop the four columns. |
| 4 | `Listing.certification String?` → `certificationAssetId` + `certificationUrl` | Backfill by inspecting whether the value is a URL or an asset key. |
| 5 | `UserType` gains `admin` | Additive enum value, but every `userType`-based guard must be re-audited before it lands. |

### 8.3 New columns on existing models (~70)

| Model | Count | Highlights |
|---|---|---|
| `User` | 7 | `phone`, `termsAcceptedAt`/`termsVersion`, `privacyAcceptedAt`/`privacyVersion` |
| `Address` | 3 + 2 indexes | `type`, `phone`, `deletedAt`, partial-unique default |
| `Listing` | 22 | dimensions, package dimensions, weights, policies, cover, slug, moderation |
| `Collection` | 7 | `type`, `coverAssetId`, `slug`, `listingCount`, `position`, `updatedAt`, `deletedAt` |
| `Order` | 13 | `orderNumber`, `statusBucket`, lifecycle timestamps, `refundStatus`, `cancellationReason` |
| `Review` | 4 + unique | `responseBody`, `respondedAt`, `updatedAt`, `deletedAt` |
| `PaymentMethod` | 4 | `type`, `cardholderName`, `billingAddress`, `deletedAt` |
| `StripeAccount` | 3 | `externalAccountType`, `externalBankName`, `payoutsPausedAt` |
| `Story` | 6 | `status`, `postedAt`, `keepAfterExpiry`, `commentCount`, `shareCount`, `deletedAt` |
| `Highlight` | 4 + relation | `isPublished`, `position`, `updatedAt`, `deletedAt`, `HighlightStory.story` back-relation |
| `Show` | 5 | `description`, `startMode`, `timezone`, `scheduledEndAt`, `options` |
| `ShopPromotion` | 6 | `startsAt`, `discountType`, `discountAmount`, `usesPerCustomer`, `orderCount` |
| `Notification` | 4 | `category`, `title`, `body`, `deepLink` |
| `TrackingEntry` | 4 | `carrier`, `status`, `lastCheckedAt`, `createdAt` |
| `ContentReport` | 7 | evidence, assignment, resolution |
| `AuditLog` | 6 | `actorUserId`, `beforeValue`, `afterValue`, `ip`, `requestId`, `userAgent` |
| `AccountDeletionRequest` | 3 | `reason`, `reasonCode`, `handledByUserId` |
| `CartItem` | 1 | `sessionId` (guest cart, web) |

### 8.4 New constraints worth calling out

Every one of these prevents a race or a data-integrity bug that application code alone will lose
(CLAUDE.md §1, §3, §4):

| Constraint | Prevents |
|---|---|
| partial `UNIQUE(userId, type) WHERE isDefault` on `Address` | two default shipping addresses |
| partial `UNIQUE(buyerId, sellerId, listingId) WHERE kind='product'` on `Conversation` | duplicate threads from a double-tapped "Message Seller" |
| `UNIQUE(conversationId, clientMessageId)` on `Message` | duplicate message on network retry |
| `UNIQUE(orderId, authorId, type)` on `Review` | duplicate reviews corrupting `ratingAvg` |
| `UNIQUE(idempotencyKey)` on `SellerLedgerEntry` | double credit from a replayed Stripe webhook |
| `UNIQUE(orderNumber)` on `Order` | collision under concurrent checkout (DB sequence, not app-side random) |
| partial `UNIQUE(orderId) WHERE status NOT IN ('resolved','withdrawn')` on `Dispute` | two open disputes on one order |
| `UNIQUE(promotionId, orderId)` on `ShopPromotionUsage` | double-counting a retried checkout |
| `UNIQUE(userId, mode, channel, type)` on `NotificationSetting` | conflicting duplicate preferences |
| `UNIQUE(sellerId, name)` on `Collection`, `ShippingPolicy`, `ReturnPolicy` | duplicate names the UI cannot disambiguate |
| `CHECK` on `ShopPromotion` discount fields | a promotion with neither a percentage nor an amount |
| `CHECK (NOT acceptsReturns OR returnWindowDays IS NOT NULL)` | a returns policy with no window |

### 8.5 Indexes required by the new screens

| Index | Screen it serves |
|---|---|
| `Order(customerId, statusBucket, createdAt)` | My Orders + status filter counts |
| `Order(providerId, statusBucket, createdAt)` | Seller Orders |
| `Conversation(sellerId, lastMessageAt DESC)` | Seller Messages list |
| `Conversation(buyerId, lastMessageAt DESC)` | Buyer Messages list |
| `Message(conversationId, createdAt)` | chat pagination |
| `NotificationSetting(channel, type, enabled)` | notification fan-out (the whole point of §5.8) |
| `SellerLedgerEntry(sellerId, occurredAt DESC)` | Earnings / payout history |
| `SellerApplication(status, priority, submittedAt)` | waitlist queue + `Queue position` |
| `Dispute(status, createdAt)` | admin dispute queue |
| `Listing(moderationStatus, createdAt)` | admin moderation queue |
| `SearchHistory(userId, createdAt DESC)` | Recent searches |
| `Listing(slug)`, `SellerProfile(slug)` | web SEO routes |

Advanced index work (GIN, trigram, partial, FTS) belongs in
[`prisma/sql/performance.sql`](../prisma/sql/performance.sql), not in `schema.prisma`.

---

## 9. Open questions — product decisions needed before the migration

These change the schema, so they should be settled before writing the migration rather than after.

1. **`Product` vs `Listing`.** `prisma/schema.prisma:417` still carries the legacy live-show `Product`
   model with a "DECISION PENDING" note, and the design uses `productId` and `listingId`
   interchangeably. Recommendation: **fold `Product` into `Listing`** and let `Show.productIds`
   reference listings. Two catalogs will drift.
2. **Story comments.** The design shows `commentCount` but there is no comment screen in the dump. Is
   commenting in scope for v1? If not, drop `StoryComment` and the counter.
3. **Multi-seller cart.** The Cart screen groups by shop. Does one checkout create **one order per
   seller** (recommended — payouts, disputes, and shipping are all per-seller) or one parent order with
   children? The existing `Order.parentOrderId` supports the latter; the design does not say.
4. **Express shipping availability.** `fastShippingPrice` / `expressShippingPrice` — is express
   per-listing (modeled here) or a shop-level setting? Per-listing is more flexible; shop-level is less
   work for sellers.
5. **`usesPerPerson` semantics.** Per customer *lifetime*, or per customer *per promotion period*? The
   constraint in §8.4 assumes lifetime.
6. **Guest checkout.** Can an unauthenticated user reach Review & Pay on web? If yes,
   `Order.customerId` must become nullable with a `guestEmail` — a much larger change than the
   `CartItem.sessionId` in §6.1. Assumed **no** throughout this document.
7. **`sellerRank`.** What is it ranked on — sales, rating, recency, a composite? The column is proposed
   but the formula is undefined.
8. **Review edit window.** `Review.updatedAt` is proposed; is editing allowed, and for how long? This
   affects whether `ratingAvg` recomputation needs to be reversible.
9. **Currency.** Is the platform single-currency (USD) at launch? Every money field carries an explicit
   currency here, but `SellerBalance` assumes **one currency per seller** — multi-currency sellers need
   a balance row per currency.
10. **Notification pause granularity.** `Pause notifications` — all channels, or push only? Modeled here
    as all channels via `pausedUntil`.

---

## 10. Suggested build order

The dependency graph, so migrations land in a workable sequence:

| Phase | Contents | Blocked by |
|---|---|---|
| **1 — Foundations** | Enums (§7), `User`/`Address` additions, `AddressType` backfill | — |
| **2 — Seller identity** | `SellerProfile`, `SellerOnboarding`, `SellerApplication`, `SellerStats` | 1 |
| **3 — Policies & catalog** | `ShippingPolicy`, `ReturnPolicy`, `ListingShippingOption`, `Listing` additions ⚠️ | 2 |
| **4 — Orders** | `Order` additions, `orderNumber` sequence, `statusBucket` backfill, `Dispute` | 3 |
| **5 — Messaging** ⚠️ | `Conversation`, `Message` rework, `MessageAttachment` | 4 (order threads) |
| **6 — Money** | `SellerBalance`, `SellerLedgerEntry`, `PaymentMethod`/`StripeAccount` additions | 4 |
| **7 — Social & promos** | `Story`/`Highlight`/`Show` additions, `StoryComment`, `ShopPromotion` ⚠️ | 3 |
| **8 — Notifications** | `NotificationSetting`, `Notification` additions, preference backfill | 1 |
| **9 — Analytics & admin** | `SellerAnalyticsDaily`, `AdminMembership`, `AuditLog` additions, `FeatureFlag` | 2, 4 |

Phases 5, 6, and 8 each need a backfill job alongside the migration; the rest are additive and safe to
deploy ahead of the code that uses them.
