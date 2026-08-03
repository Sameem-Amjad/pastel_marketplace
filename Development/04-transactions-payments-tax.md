# 04 — Transactions, Payments & Tax

> The hardest subsystem to replace, because Sharetribe did it invisibly: an order **state-machine engine**, **server-authoritative pricing**, **direct Stripe Connect with escrow**, **refunds/disputes**, and **tax**. This document specifies the behavior to reproduce. Schema in doc 02 §5–7.

---

## 1. The order state-machine engine

### 1.1 Why a generic engine
Sharetribe defined each transaction process as an **EDN file** (`ext/transaction-processes/*/process.edn`): a set of **states**, **transitions** (with actor + actions), and **time-based transitions**. We reproduce this as a **data-driven engine**, not hardcoded `if/else`. Processes are seeded into `ProcessDef.definition` (JSON), so adding states/transitions doesn't need a migration.

### 1.2 Process definition shape
```jsonc
// ProcessDef.definition for "instant-purchase/release-14"
{
  "initial": "initial",
  "states": [
    "initial","inquiry","payment-intent-created","pending-update-child-transactions",
    "pending-payment","payment-expired","purchased","pending-shipment","shipped",
    "delivered","received","completed","disputed","escalated-dispute","declined-dispute",
    "pending-replacement","replacement-sent","pending-partial-refund","partially-refunded",
    "canceled","reviewed-by-customer","reviewed-by-provider","reviewed","pending-confirmation", ...],
  "transitions": [
    { "name": "request-payment", "from": ["initial"], "to": "pending-payment",
      "actor": ["customer"], "privileged": true,
      "actions": ["set-line-items","stripe-create-payment-intent"] },
    { "name": "confirm-payment", "from": ["pending-payment"], "to": "purchased",
      "actor": ["customer"], "privileged": true,
      "actions": ["stripe-confirm-payment-intent","stripe-capture-payment-intent"] },
    { "name": "mark-shipped", "from": ["pending-shipment"], "to": "shipped",
      "actor": ["provider"], "actions": [] },
    { "name": "mark-received-from-delivered", "from": ["delivered"], "to": "received",
      "actor": ["customer"], "actions": ["stripe-create-payout"] },
    ...
  ],
  // Timers below are reproduced VERBATIM from instant-purchase/process.edn.
  // `after` = ISO-8601 duration measured from `time/first-entered-state` of `from`;
  // entries with after:"immediate" carry no :fn/period and fire on entry.
  "timers": [
    { "name": "expire-payment", "from": "pending-payment", "after": "PT15M",
      "to": "payment-expired", "actions": ["calculate-full-refund","stripe-refund-payment"] },
    { "name": "auto-cancel", "from": "purchased", "after": "P3D",
      "to": "canceled", "actions": ["calculate-full-refund","stripe-refund-payment"] },
    { "name": "auto-mark-received", "from": "delivered", "after": "P14D",
      "to": "received", "actions": ["stripe-create-payout"] },
    { "name": "auto-complete", "from": "received", "after": "immediate",
      "to": "completed", "actions": [] },
    { "name": "expire-review-period", "from": "completed", "after": "P7D",
      "to": "reviewed", "actions": [] },
    { "name": "expire-provider-review-period", "from": "reviewed-by-customer", "after": "P7D",
      "to": "reviewed", "actions": ["publish-reviews"] },
    { "name": "expire-customer-review-period", "from": "reviewed-by-provider", "after": "P7D",
      "to": "reviewed", "actions": ["publish-reviews"] },
    { "name": "auto-escalate-dispute", "from": "disputed", "after": "P3D",
      "to": "escalated-dispute", "actions": [] },
    { "name": "auto-escalate-declined-dispute", "from": "declined-dispute", "after": "immediate",
      "to": "escalated-dispute", "actions": [] },
    { "name": "auto-escalate-replacement", "from": "pending-replacement", "after": "P7D",
      "to": "escalated-dispute", "actions": [] },
    { "name": "auto-release-from-partially-refunded", "from": "partially-refunded", "after": "P14D",
      "to": "received", "actions": ["stripe-create-payout"] }
  ]
}
```

**State list (instant-purchase, complete).** The EDN references these `:state/*`
keywords — the ProcessDef seed must enumerate all of them:
`initial`, `inquiry`, `payment-intent-created`, `pending-update-child-transactions`,
`pending-payment`, `payment-expired`, `purchased`, `pending-shipment`, `shipped`,
`delivered`, `received`, `completed`, `disputed`, `escalated-dispute`,
`declined-dispute`, `pending-replacement`, `replacement-sent`,
`pending-partial-refund`, `partially-refunded`, `canceled`, `reviewed-by-customer`,
`reviewed-by-provider`, `reviewed`, `pending-confirmation`.
(`inquiry`/`payment-intent-created`/`pending-update-child-transactions` come from the
cart-oriented entry transitions; `pending-confirmation` and `pending-partial-refund`
are referenced by sibling processes and reserved here for parity.)

> ⚠️ **EDN typo to normalize on seed.** `:transition/escalate-dispute` (the
> *manual* customer escalation, `disputed → ...`) targets `:state/escalated-disputed`
> — note the trailing **"d"** — while every other transition (`auto-escalate-dispute`,
> `auto-escalate-declined-dispute`, `auto-escalate-replacement`, the operator
> refund/release transitions) uses `:state/escalated-dispute`. In Sharetribe these are
> two *distinct* states, so the manual-escalate path effectively dead-ends in a state
> with no outbound transitions. **The new ProcessDef seed MUST normalize both spellings
> to the single canonical `escalated-dispute`** (a one-line migration rewrite when
> loading the EDN → JSON), or the customer-initiated escalation will strand orders.
> See §1.6 migration notes.

### 1.3 Transition execution (the heart)
Every transition runs inside **one DB transaction** with this contract:

```
attemptTransition(orderId, transitionName, actor, params):
  BEGIN
    order = SELECT ... FOR UPDATE                       # row lock — serializes concurrent transitions
    def   = process registry for order.processAlias
    t     = def.transition(transitionName)
    assert order.state ∈ t.from           else 409 conflict (state changed)
    assert actor allowed by t.actor        else 403
    if t.privileged: recompute line items server-side   # never trust client
    for action in t.actions:               # run side-effect actions (see §1.4)
       execute(action, order, params)       # idempotent; Stripe calls keyed by (orderId, transition)
    INSERT OrderTransition(from,to,actor,...)
    UPDATE order.state = t.to, lastTransition, lastTransitionedAt, totals
    upsert ScheduledTransition rows for timers leaving t.to ; cancel timers from old state
    INSERT Outbox('order.transitioned', {orderId, from, to})
  COMMIT
```

Key properties:
- **Optimistic/pessimistic guard:** `SELECT … FOR UPDATE` + `from`-state assertion makes concurrent transitions safe (e.g. buyer `mark-received` racing the P14D timer — exactly one wins; the loser sees a 409 and no-ops).
- **Idempotent actions:** Stripe/TaxJar calls use idempotency keys derived from `(orderId, transition)`; replays don't double-charge/refund/pay out.
- **Timers as data:** on entering a state, we insert `ScheduledTransition(run_at = now + ISO8601 duration, guardState = state)`. A worker fires them; the same `attemptTransition` runs, guarded by `guardState` so a stale timer is a no-op.

### 1.4 Action catalog (maps EDN actions → our code)
| EDN action | Our implementation |
|---|---|
| `privileged-set-line-items` / `set-line-items` | Pricing engine recomputes `LineItem[]` (§2). |
| `stripe-create-payment-intent` | Payments: `paymentIntents.create` (§3). |
| `stripe-confirm-payment-intent` | (client confirms; we verify status). |
| `stripe-capture-payment-intent` | Payments: capture (escrow hold). |
| `stripe-create-payout` | Payments: transfer to seller (escrow release) (§3.4). |
| `stripe-refund-payment` | Payments: refund (§4). |
| `calculate-full-refund` | Pricing: negated reversal of all customer-side line items. |
| `create/accept/decline/cancel-pending-stock-reservation` | Catalog stock + `StockReservation` (§5). |
| `update-protected-data` | Write `Order.protectedData`. |
| `post-review-by-customer` / `post-review-by-provider` | Record one side's two-sided review (held until `publish-reviews`). |
| `publish-reviews` | Make both reviews visible once the second side reviews or the P7D review timer fires. |
| (notifications) | We emit via outbox; Sharetribe's purchase processes sent **no** Sharetribe emails (`:notifications []`) — all order email is ours. |

### 1.5 Processes to implement
1. **`instant-purchase`** (PRIMARY, alias `release-14`) — ~70 transitions incl. dispute/replacement/escalation + the operator refund block (full/partial/release/approve-replacement from every pre-payout state) + timers PT15M/P3D/P7D/P14D (+ two *immediate* timers `auto-complete` and `auto-escalate-declined-dispute`). The bulk of the work.
2. **`cart-stock`** — stock-reservation lifecycle of the **child** transaction (§5, §1.7). Timers PT15M / P60D.
3. **`default-purchase`** — legacy single/cart-parent. Distinct timers from instant-purchase: `auto-cancel` **P14D** (not P3D), `auto-cancel-from-disputed` **P60D**; and a legacy `pending-partial-refund` operator path (§1.8).
4. **`inquiry`** — single transition, no payment.
5. **`booking`** — schema seam only (dormant); defer engine.

Happy path (instant-purchase):
```
initial ─request-payment(priv)→ pending-payment ─confirm-payment(priv: confirm+capture)→ purchased
purchased ─confirm-order(provider)→ pending-shipment ─mark-shipped→ shipped ─mark-delivered→ delivered
delivered ─mark-received-from-delivered(customer: PAYOUT)→ received ─auto-complete(immediate)→ completed ─reviews / expire-review-period(P7D)→ reviewed
(received also reachable directly from shipped via mark-received-from-shipped → PAYOUT)
```
Timers (verbatim from EDN — see §1.2 table; from = first-entered-state):
```
pending-payment        ─PT15M→ payment-expired        (calculate-full-refund + stripe-refund-payment)   ⚠ NOT "canceled"
purchased              ─P3D  → canceled               (calculate-full-refund + stripe-refund-payment)
delivered              ─P14D → received               (stripe-create-payout)
received               ─immediate→ completed          (auto-complete; "first-entered received")
completed              ─P7D  → reviewed               (expire-review-period)
reviewed-by-customer   ─P7D  → reviewed               (expire-provider-review-period; publish-reviews)
reviewed-by-provider   ─P7D  → reviewed               (expire-customer-review-period; publish-reviews)
disputed               ─P3D  → escalated-dispute      (auto-escalate-dispute)
declined-dispute       ─immediate→ escalated-dispute  (auto-escalate-declined-dispute; decline auto-escalates to support)
pending-replacement    ─P7D  → escalated-dispute      (auto-escalate-replacement)
partially-refunded     ─P14D → received               (auto-release-from-partially-refunded; stripe-create-payout — mirrors auto-mark-received so funds aren't stranded)
```
Disputes / replacements:
```
{pending-shipment|shipped|delivered} ─dispute-from-*→ disputed
disputed ─approve-replacement→ pending-replacement ─provider-confirm-replacement-sent→ replacement-sent ─customer-confirm-replacement-received(PAYOUT)→ received
disputed ─decline-replacement / decline-refund→ declined-dispute ─(immediate)→ escalated-dispute
disputed ─approve-refund(full refund)→ canceled        ·  disputed ─escalate-dispute(customer)→ escalated-dispute*
pending-replacement ─dispute-replacement→ disputed     ·  pending-replacement ─P7D→ escalated-dispute
escalated-dispute ─operator-approve-refund→ canceled   ·  escalated-dispute ─operator-decline-refund(PAYOUT)→ received
*the manual escalate-dispute EDN typo (escalated-disputed) must be normalized — §1.2 / §1.6.
```

### 1.6 Migration notes (EDN → JSON ProcessDef seed)
- **Normalize the `escalated-disputed` typo.** When converting `instant-purchase/process.edn`
  to JSON, rewrite every `escalated-disputed` → `escalated-dispute` so the manual
  `escalate-dispute` (customer) path lands in the same state the operator transitions and
  the auto-escalation timers use. Without this the order has no way out (dead-end state).
- Collapse Sharetribe `:state/...` / `:transition/...` keywords to bare names; map
  `:fn/timepoint [:time/first-entered-state X]` → timer anchored at first entry of `X`,
  `:fn/period ["…"]` → ISO-8601 `after`. A timer with a `:fn/timepoint` and **no**
  `:fn/period` (e.g. `auto-complete`, `auto-escalate-declined-dispute`) fires immediately
  on state entry — model as `after: "PT0S"`/`immediate`.

### 1.7 Cart parent/child transaction orchestration
Cart checkout is **not** a single transaction. The buyer's checkout creates a **parent
order** in `default-purchase`/`instant-purchase` whose entry path is, in order:

```
create-payment-intent  → payment-intent-created
request-payment        → pending-update-child-transactions      ← structurally mandatory intermediate state
update-child-transactions → pending-payment
confirm-payment        → purchased
```

(After an inquiry the equivalent path uses `create-payment-intent-after-inquiry` /
`request-payment-after-inquiry` from `inquiry`.)

The intermediate `pending-update-child-transactions` parent state exists **precisely so
the parent can spawn one `cart-stock` CHILD transaction per listing** before money is
confirmed:

- The **parent** order stores a **`childTransactions` map** (listingId → child tx id) in
  its protected data; each **child** stores `parentTransactionId` pointing back.
- The child runs the dedicated **`cart-stock` process** (§5, §1.9) — it is a pure
  **stock-reservation** lifecycle, no payment of its own. Reserving stock per line item in
  separate children is what makes a partial cart safe (one sold-out listing fails its own
  child without unwinding the whole charge).
- `update-child-transactions` is the seam that links them and advances the parent to
  `pending-payment` once every child reservation is in place.

This is a **STOCK split, not a money split**: it is a **single-vendor parent order** (all
line items belong to one author) of **≤ 50 line items**, paid by **one** PaymentIntent on
the parent. The **MULTI-SELLER split is a separate, client-side mechanism**: the cart UI
groups items by author and runs **per-author checkout**, creating a **separate parent
order (and separate PaymentIntent) per seller**. `Order.parentOrderId` (defined in doc 02
§5) is the persisted FSM seam — child orders set it to the parent; the new backend keys the
`childTransactions`/`parentTransactionId` linkage off the same column rather than off
protected-data blobs.

### 1.8 `default-purchase` distinctions (vs instant-purchase)
`default-purchase` is the legacy single-item / cart-parent process. It shares the entry
path and review block but differs in timers and the partial-refund mechanism:

- `auto-cancel` is **P14D** (`purchased → canceled`), **not** P3D as in instant-purchase.
- `auto-cancel-from-disputed` is **P60D** (`disputed → canceled`, full refund) — a
  long-tail safety so disputed legacy orders eventually self-cancel.
- Partial refunds use a **two-step operator path through a `pending-partial-refund`
  state**, NOT instant-purchase's `partially-refunded` state:
  `operator-pending-partial-refund-from-disputed` (`disputed → pending-partial-refund`,
  no actions) then `operator-mark-received-with-partial-refund`
  (`pending-partial-refund → received`, no EDN actions — the actual refund + payout are
  driven out-of-band by `admin-refunds.js`). This is a **different mechanism** from
  instant-purchase's proportional `partially-refunded` flow (§4.2); the new backend should
  treat them as two refund regimes and prefer the instant-purchase proportional one for
  new orders.
- Other timers match instant-purchase: `expire-payment` PT15M → `payment-expired`,
  `auto-mark-received` P14D (`delivered → received`), `auto-complete` immediate
  (`received → completed`), and the three P7D review-expiry timers.

### 1.9 `cart-stock` process (the child)
The child reservation lifecycle (`cart-stock-process/process.edn`):

```
reserve-stock(customer)        → pending-stock      (create-pending-stock-reservation)
pending-stock ─confirm-stock(customer)→ purchased   (accept-stock-reservation)
pending-stock ─cancel-pending-stock(customer)→ canceled (decline-stock-reservation — immediate release on checkout failure)
pending-stock ─auto-expire-stock (PT15M)→ canceled   (decline-stock-reservation — the 15-min timeout)
purchased     ─cancel-stock(operator)→ canceled      (cancel-stock-reservation)
purchased     ─complete-stock(operator)→ completed   (no actions)
purchased     ─auto-complete-stock (P60D)→ completed  (no actions)
```

So the child has **two** terminal timers: PT15M `auto-expire-stock` (releases an
unconfirmed reservation) and **P60D `auto-complete-stock`** (`purchased → completed`,
long-tail cleanup), plus the operator `cancel-stock`. The new backend's
`StockReservation` worker (§5) reproduces both the PT15M expiry and the P60D completion.

---

## 2. Pricing engine (server-authoritative)

> Port the pure functions in `lineItems.js` / `cartLineItems.js` / `lineItemHelpers.js` / `taxLineItems.js` verbatim into a `PricingModule`. Clients NEVER set prices.

### 2.1 Money
`Money = { amountMinor: bigint, currency }`. All math via a decimal library; round **HALF_UP to whole minor units**. Subunit divisor per currency (USD=100; JPY/KRW=1). Persist as `BIGINT` cents.

### 2.2 Line-item codes & the `includeFor` model
```
payinTotal  = Σ lineTotal where includeFor ∋ 'customer'
payoutTotal = Σ lineTotal where includeFor ∋ 'provider'
margin      = payinTotal − payoutTotal     # platform take = Stripe application fee
```
Codes (all `line-item/*`): `item`, `shipping-fee`, `pickup-fee`(0), `shipping-discount`, `sales-tax`, `app-promo-discount`, `provider-commission`(−%), `customer-commission`(+%).

> **Unit-type codes.** The product line uses `line-item/item` for the `item` unit type,
> but Sharetribe defines parallel unit codes `line-item/day`, `line-item/night`, and
> `line-item/hour` for the non-`item` unit types (`LISTING_UNIT_TYPES` in
> `src/util/types.js`; `lineItemHelpers.js`/`lineItems.js` switch on them for the base
> price). Pastel today only sells `item`, but the pricing engine must keep the unit-code
> seam so booking/rental listings (the dormant `booking` process) drop in without a
> pricing rewrite.

### 2.3 Single-item formula
```
item               : unitPrice × quantity                         includeFor [customer, provider]
shipping-fee       : shipOneItem + shipAddlItem × (quantity − 1)  includeFor [customer, provider]  # seller keeps it
pickup-fee         : 0
sales-tax          : TaxJar amount (US + nexus only)              includeFor [customer]
provider-commission: subtotal(item) × (−providerPct)             includeFor [provider]   # reduces payout
customer-commission: subtotal(item) × (+customerPct)             includeFor [customer]   # adds to payin
```
Commission base = **item subtotal only** (shipping not commissioned). Commission line only created when `pct > 0`.

> **Max 50 line items — NOT enforced today.** The "max 50" is a *Sharetribe-side* cap
> (only a doc comment in `lineItems.js`/`cartLineItems.js`); the current code does not
> validate it, it relied on Sharetribe rejecting oversized line-item arrays. The new
> backend owns this boundary, so it must **actively enforce ≤ 50 line items** (and the
> ≤ 50-line-item cart limit of §1.7) at speculate/initiate, returning a clear error
> rather than letting an oversized array reach Stripe.

### 2.4 Cart formula (multi-listing)
- One `item` line per listing (`unitPrice × count`), `[customer, provider]`.
- **Shipping**, two regimes (`cartLineItems.js`). Note the **deliberate asymmetry** in how
  each regime bounds the `shipping-discount`:
  - *Fixed/seller-set* (rate id `fixed-`/`aggregated-`): multi-item discount — top item
    charged full shipping, each remaining item applies **its own** stated discount with
    **net per-item shipping floored at 0** (`Math.max(0, fullCost − statedDiscount)`).
    The aggregate `shipping-discount` is the sum of the **full stated** per-item discounts
    and is **NOT capped** — it can exceed total net shipping. This is intentional and is
    applied on **both sides** (`[customer, provider]`) so the discount cancels out of the
    margin and `payin ≥ payout` still holds.
  - *Carrier/Shippo live rate*: discount **is capped at the live rate**
    (`Math.min(totalDiscountCents, rateAmount × 100)`); shipping itself is `[customer]`
    only (platform covers the label).
  - Discount surfaced as `shipping-discount` (negative). Because the fixed regime applies it
    on both sides, an uncapped discount never breaks `payin ≥ payout`; the Shippo regime caps
    it because there is no provider-side offset to absorb an overshoot.
- **App promo** (`app-promo-discount`): `type:'shipping'` waives shipping `[customer, provider]`; else percentage off item subtotal `[customer]` only (seller payout unchanged).
- **Commission** base = sum of item lines only.

### 2.5 Speculative pricing
Checkout calls a **speculate** path that runs the exact same computation **without** creating an order or touching Stripe — for the live price preview. The operator refund console uses the same speculative-then-commit pattern (§4.4).

### 2.6 Promo validation & usage
- Validate against `Discount` (global) + `ShopPromotion` (per-seller): active, not expired, scope/ownership, remaining usage.
- **Single-use enforced by a unique constraint** `(userId, discountId)` / `(userId, promotionId)` — replaces Firestore's `{userId}-{code}` doc-id guard. Insert the usage row in the **same transaction** as order creation; a duplicate insert → reject as already-used (race-safe).

---

## 3. Stripe Connect (direct) — escrow model

> Today Sharetribe brokers Stripe via its platform account; **nothing in the repo calls Stripe server-side**. We now own this end to end.

### 3.1 Account model
- **Sellers:** Stripe **Custom Connect** accounts (`accounts.create({type:'custom', capabilities:{card_payments, transfers}})`), onboarded via `accountLinks.create`. Mirror `chargesEnabled`/`payoutsEnabled`/`requirementsDue` in `StripeAccount` (refresh on `account.updated` webhook — replaces today's iOS polling).
- **Buyers:** Stripe **Customers** + saved cards via `SetupIntent` + `paymentMethods.attach`.

> **Net-new vs today's card model.** TODAY (`src/ducks/paymentMethods.duck.js`) the buyer
> has exactly **ONE default payment method** on the Sharetribe stripe-customer — there is no
> card *list*; changing cards is **delete + re-add** (`deletePaymentMethod` then
> `addPaymentMethod`). And **SetupIntent creation is server/Sharetribe-side** (nothing in the
> repo creates a SetupIntent client-side). The multi-card model described here (a list of
> saved `PaymentMethod`s, a client-initiated SetupIntent flow, an explicit default) is a
> **net-new SUPERSET** — fine to build, but label it as new behavior, not a 1:1 port. The
> minimum parity is reproducing the single-default-card behavior; the card list is an
> enhancement.

### 3.2 Charge model decision — **separate charges + transfers** (not destination charges)
The product's escrow rule is: **hold funds until the buyer confirms receipt** (or P14D), then pay the seller. That maps to:
1. **Charge on the platform account** at checkout: `paymentIntents.create({ amount: payin, currency, customer, payment_method, capture_method: 'automatic', metadata:{orderId} })`. Funds land on the **platform balance** (escrow).
2. **Confirm** client-side (3DS/SCA via `stripe.confirmPayment`), then the order transitions to `purchased`.
3. **Release** at `mark-received`/auto: `transfers.create({ amount: payout, currency, destination: sellerAccountId, transfer_group: orderId, source_transaction? })`. `payout = payoutTotal`; platform keeps `margin`.

Why not destination charges with `transfer_data.destination`? Those transfer to the seller **at capture**, which breaks the hold-until-received escrow and complicates refunds before payout. Separate charges+transfers preserves the exact current semantics and keeps refunds simple while funds are still on the platform.

> Capture timing: today Sharetribe **confirms + captures together** at `confirm-payment` (no auth-only hold). We mirror that (`capture_method: 'automatic'`). If true card-level escrow is ever wanted, switch to `capture_method: 'manual'` — a deliberate behavior change, not v1.

### 3.3 Application fee / platform margin
With separate charges+transfers there is no Stripe `application_fee` object; the **margin stays on the platform balance** naturally (we charge `payin`, transfer `payout`, keep the difference). Record `applicationFeeAmount = payin − payout` on `PaymentIntent` for reporting.

### 3.4 Payout = escrow release (the irreversibility boundary)
- Fires at `mark-received` (buyer) or `auto-mark-received` (P14D) — and operator `release`.
- On success set `Order.payoutReleased = true`, `Payout.status='paid'`. **This is the point of no return** for automated refunds (§4.3).
- Retried via queue on transient failure; idempotent on `transfer_group`/idempotency key.

### 3.5 Webhooks (new responsibility)
HMAC-verified, deduped via `StripeEvent.id`, processed idempotently:
| Event | Action |
|---|---|
| `account.updated` | Refresh `StripeAccount` capabilities/requirements (onboarding completion). |
| `payment_intent.succeeded` / `payment_intent.payment_failed` | Reconcile `PaymentIntent.status`; advance/abort order. |
| `charge.refunded` | Reconcile `Refund`. |
| `transfer.created` / `transfer.reversed` | Reconcile `Payout`. |
| `charge.dispute.created` (chargeback) | Open an internal dispute; alert ops (NOT modeled by Sharetribe today — net-new safety). |

---

## 4. Refunds & disputes

Port `admin-refunds.js` + `refunds/{constants,eligibility,lineItems}.js`.

### 4.1 Types
- **Full refund** → order to `canceled`; refund = current payin.
- **Partial refund** → order to `partially-refunded`; proportional reversal (§4.2). This is
  the **instant-purchase** mechanism. The legacy **`default-purchase`** path instead routes
  `disputed → pending-partial-refund → received` (operator transitions with no EDN actions;
  the refund + payout are applied out-of-band by `admin-refunds.js`) — see §1.8. Prefer the
  proportional `partially-refunded` regime for new orders.
- **Release** → pay out seller (`received`); crosses the payout boundary.
- **Replacement** → seller re-ships, no money moves (`pending-replacement`).
- Reasons: `damaged_product, not_delivered, wrong_item, not_as_described, other` (+ free-text note ≤1000 chars).

### 4.2 Partial-refund math (proportional)
```
f = refundCents / payinCents                       # 0 < f < 1  (strictly less; == → use full refund)
for each line item:  reversalCents = -round(f × lineTotal)   # preserve includeFor
submit [...originals, ...reversals]                # replace semantics
refund via Stripe: refunds.create({ payment_intent, amount: refundCents })
```
This scales commission (platform keeps no fee on refunded money), tax (authority-correct), shipping, and promo automatically. Skip zero-cent reversals to stay ≤50 line items.

### 4.3 Eligibility — the payout boundary
```
PAYOUT_RELEASED_STATES = [received, completed, reviewed-by-customer, reviewed-by-provider, reviewed]
if order.payoutReleased (or state ∈ PAYOUT_RELEASED_STATES):
    return 409 "Funds already paid out; requires a manual Stripe Connect clawback"
REFUNDABLE = [purchased, pending-shipment, shipped, delivered, disputed, declined-dispute,
              escalated-dispute, pending-replacement, replacement-sent, partially-refunded]
RELEASE/REPLACEMENT only from DISPUTE states.
```
Post-payout clawback (transfer reversal `transfers.createReversal`) is a **deliberate Phase-4** capability, not v1 — matching today's behavior (manual).

### 4.4 Speculative-then-commit
Operator endpoints (`/admin/orders/:id/refund`) run a **dry-run** computing the exact charge-back amount, return a preview, then commit on confirm — never trusting locally-computed amounts. Every action writes `Order.metadata.lastOperatorAction = {type, mode, refundedCents, currency, reason, note, actor, at}` and an `AuditLog` row.

---

## 5. Stock & cart reservation

- **Per-listing stock**, CAS via `Listing.stockVersion` (replaces `sdk.stock.compareAndSet`): `UPDATE listing SET stockQuantity = q-Δ, stockVersion = v+1 WHERE id=? AND stockVersion=?` — 0 rows ⇒ conflict, retry/abort.
- **Cart reservation** (replaces `cart-stock-process`): on checkout start, insert `StockReservation(state='pending', expiresAt=now+15m)` and decrement available stock; on payment confirm → `confirmed`; on failure/cancel → release; a worker expires `pending` past `expiresAt` (replaces the PT15M EDN timer).
- **Auto-close** sold-out listings after purchase (CAT-4). Today `handleStock`
  (`server/api/transactions.js`) reacts to a transition by closing any **published**
  listing whose stock has hit **0** (`sdk.listings.close`) **and clearing that listing's
  product (back-in-stock) notifications**. The new backend folds this into the
  `mark stock` step of the transition: when a CAS decrement brings `stockQuantity` to 0 on a
  published listing, close it and clear its product-notification subscriptions in the same
  outbox-driven flow (tie to CAT-4).
- Variant-level stock available for free if needed (`ListingVariant`) — a capability Sharetribe lacked.

---

## 6. Tax (TaxJar)

Port `taxjar.js` / `taxLineItems.js` / `taxjarSync.js`.
- **Rate resolution:** live TaxJar `POST /v2/taxes`; static `tax.json` fallback on error/no-token. Gating: destination US → nexus gate (seller nexus states ∪ platform `TAX_JAR_NEXUS_STATES`/addresses; empty ⇒ never collect) → compute. `null` for pickup.
- **When added:** recompute tax line at initiate AND confirm (never trust); write `Order.salesTaxSnapshot {hasNexus, rate, amountToCollectCents, source}`. Mode: default → tax `[customer]` (+); `localTaxes` → `[provider]` (−, withheld from seller).
  > **Single-item path hardcodes `localTaxes=false`.** Today the single-item pricing path
  > calls `buildSalesTaxLineItem(tax, [order], false)` in `lineItems.js` — withheld-tax
  > (`localTaxes`) mode is **cart-only** (`cartLineItems.js` derives `listingsIncludeTax`
  > from every listing's `publicData.localTaxes`). The new backend should make the mode a
  > uniform per-listing input across both the single and cart paths instead of hardcoding
  > `false` for single items.
- **Reporting:** on confirm → TaxJar order `pastel-{orderId}`; on refund/cancel → TaxJar refund `pastel-refund-{orderId}-{suffix}` (amounts × refund fraction). Idempotent by id. Fire via outbox.
  > **Refund fraction — derive, don't store.** `taxjarSync.js` reads
  > `taxJarRefundFraction` (or `refundFraction`) from `protectedData`, **defaulting to 1**.
  > A *partial* refund with no fraction set therefore **reports the FULL refund amounts to
  > TaxJar and over-refunds the tax** (the code even logs this case). The new backend must
  > **DERIVE the fraction from the actual refund** — `fraction = refundCents / payinCents`,
  > clamped to `[0,1]` — rather than trusting a stored field, so tax always reverses in
  > proportion to the money actually returned.
- **Parallel internal sales-tax dashboard pipeline.** Alongside TaxJar, an independent
  internal pipeline tracks sales tax for the tools dashboard:
  `server/api-util/salesTaxTracking.js` (`syncSalesTaxForTransition`) posts to the tools
  service `/sales-tax/record` (on confirm) and `/sales-tax/refund` (on refund/cancel). It
  fires from the **same transition hooks** as TaxJar (`server/api/notifications.js`,
  `server/api/transition-privileged.js`) but is **gated independently** (`isToolsConfigured()`
  / `ADMIN_SECRET` + tools URL). The new backend must reproduce **both** reporting sinks off
  the one transition event (TaxJar + internal dashboard), each toggleable on its own so one
  can be disabled without affecting the other.
- Admin TaxJar CRUD + sync endpoints retained.

---

## 7. Shipping (Shippo)

Port `shippo.js` / `order-tracking.js`.
- Address validate/parse, rates, specific rate, label create.
- Carrier live rate feeds the cart shipping line (§2.4); seller fixed shipping is the alternative.
- Manual `TrackingEntry` save/read per order; tracking notifications via outbox.

> 🔒 **Security fix required: `order-tracking.js` authenticates but does NOT authorize.**
> The current `POST /api/orders/tracking` handler calls `sdk.currentUser.show()` to confirm
> the caller is *logged in*, then writes `TrackingEntry` for the given `transactionId` —
> but it **never checks the caller is a party to that transaction**. Any logged-in user can
> overwrite **any** order's tracking by supplying its `transactionId` (an IDOR). The new
> backend MUST enforce an **owner/seller authorization rule** on `TrackingEntry` writes:
> load the order, and reject (403) unless the authenticated user is the order's **provider
> (seller)** — and only the seller should set tracking — with operator override allowed.
> The GET path should likewise be limited to the order's buyer/seller/operator.

### 7.1 Order email reminder timing (parity)
`server/api-util/order-email-reminders.js` schedules two reminders off transition hooks and
cancels them when the relevant action happens. The new backend's scheduler must reproduce
these exact offsets:

| Reminder | Scheduled on transition | Offset (from that transition) | Canceled by |
|---|---|---|---|
| Shipping reminder | `confirm-order` | **2 days** (`SHIPPING_REMINDER_MS`) | `mark-shipped`, `cancel`, `cancel-from-pending-shipment`, `cancel-from-purchased`, `auto-cancel` |
| Shipping reminder (no `confirm-order` step) | `confirm-payment` | **3 days** (`SHIPPING_REMINDER_DEFAULT_MS`) | same as above |
| Order-received reminder | `mark-delivered` / `operator-mark-delivered` | **12 days** (`ORDER_RECEIVED_REMINDER_MS`) | any `mark-received-*` / `auto-mark-received` |

Note the asymmetry: a flow with a provider `confirm-order` step reminds at **2 days**, while
a flow that goes straight to shipping from `confirm-payment` reminds at **3 days**. The
received reminder at **12 days** lands just before the **P14D** `auto-mark-received` payout
(§1.2), nudging the buyer to confirm before funds auto-release.

---

## 7b. Orders, conversations & seller views

The transaction record is also the conversation and the seller's order book. A few
behaviors the new backend must preserve (they are NOT in transaction state):

- **Multi-transaction conversation merge.** A buyer/seller thread can span **several
  related transaction ids** (e.g. an `inquiry` tx plus the later `order` tx for the same
  listing/parties). `TransactionPage.duck.js` queries messages across **all** related tx
  ids and **merges** them into one chronological thread (`mergeEntityArrays`,
  `fetchMessagesFromAllTransactions`). The new backend should model a **Conversation**
  spanning related orders so the UI keeps one merged thread, rather than one-thread-per-tx.
- **Unread state lives outside transaction data.** Read/unread and the bell badge are NOT
  stored on the transaction — they live in the **notification / Firebase layer**
  (`server/api/notifications.js`, the message-sent ping). Don't try to derive unread from
  `lastTransition`; carry it as a separate notification concern.
- **Individual per-listing reviews are a separate store.** `storeIndividualReview`
  (`src/util/api.js`, `TransactionPage.duck.js`) writes a **Pastel** per-listing review
  that is **distinct** from the two-sided transition reviews
  (`review-1/2-by-customer/provider` → `reviewed`). The new backend keeps **two** review
  surfaces: the FSM two-sided reviews (gated by the review transitions) and the standalone
  individual product review.
- **Inbox / MessagesPage / ShopManager hide DIFFERENT transition sets.** `InboxPage.duck.js`
  filters the transaction query by a curated `lastTransitions` allow/deny set (e.g. it hides
  `inquire-without-payment`, `create-payment-intent`, and cart-stock child transitions);
  MessagesPage and ShopManager use **different** visible-transition sets. The new backend
  must expose **granular query filters** (by process, by state, by last-transition set,
  exclude-child-transactions) rather than one hardcoded list, since each surface needs its
  own slice.
- **ShopManager total-sales is computed by paging ALL transactions client-side.**
  `ShopManagerPage.duck.js` fetches page 1 (perPage 100), reads `totalPages`, then fetches
  **every** remaining page in parallel and sums non-canceled transaction totals in the
  browser. This is O(all-orders) per page load and won't scale. The new backend should
  provide an **efficient server-side seller-sales-total endpoint** (a single aggregate
  query) instead of client-side paging.

---

## 8. Idempotency & failure handling (summary)

| Risk | Mitigation |
|---|---|
| Double charge on retry | Inbound `Idempotency-Key` on `/checkout`; outbound Stripe idempotency key `(orderId, request-payment)`. |
| Double payout | `Payout` unique per order; idempotency key `(orderId, payout)`; CAS on `payoutReleased`. |
| Double refund | `Refund` rows + Stripe idempotency key `(orderId, refund, attempt)`. |
| Lost side-effect (email/tax/payout) | Outbox in same tx + retry worker. |
| Stale timer firing | `ScheduledTransition.guardState` + `FOR UPDATE` state assertion. |
| Partial failure mid-transition | Whole transition is one DB tx; Stripe call failure rolls back the state change; reconciled by webhook + retry. |
| Webhook replay | `StripeEvent` dedupe by event id. |

---

## 9. What to build first (this subsystem)
1. Pricing engine (pure, fully unit-tested against current outputs) + `CommissionConfig`.
2. State-machine engine + `instant-purchase` process + `ScheduledTransition` worker.
3. Stripe Connect: onboarding, customer/cards, PaymentIntent + capture, **payout**, webhooks.
4. Refund/dispute block (full → partial → release/replacement) with eligibility + speculative commit.
5. Tax + shipping wiring.
6. `cart-stock` + `default-purchase` + `inquiry` processes.

Validation gate: replay a sample of historical Sharetribe transactions through the new engine and assert identical line items, payin/payout, and final state (doc 07 §dual-run).
