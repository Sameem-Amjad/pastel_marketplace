import Decimal from 'decimal.js';
import { IncludeFor, LineItemCode } from '@prisma/client';

/** One sellable line going into pricing (listing unit price × quantity). */
export interface PriceLineInput {
  unitPriceAmount: bigint; // minor units
  quantity: number;
}

/** Everything the pricing engine needs. Computed entirely server-side — clients never send totals. */
export interface PriceInput {
  currency: string;
  items: PriceLineInput[];

  commission: {
    providerPercentage: Decimal.Value; // % withheld from seller payout
    customerPercentage: Decimal.Value; // % added to buyer payin
  };

  /** Pickup orders have no shipping fee (pickup_fee is 0). */
  pickup?: boolean;
  shippingFeeAmount?: bigint;
  shippingDiscountAmount?: bigint;

  /** Sales tax in minor units, computed by the tax service. Defaults to the customer (added to payin). */
  taxAmount?: bigint;
  taxIncludeFor?: 'customer' | 'provider'; // 'provider' == localTaxes (withheld from payout)

  /** Platform-funded promo (app_promo_discount): reduces buyer payin, NOT seller payout. */
  promoDiscountAmount?: bigint;
}

/** A computed line, ready to persist as a LineItem row (doc 02 §5, doc 04 §2). */
export interface ComputedLineItem {
  code: LineItemCode;
  unitPriceAmount: bigint;
  quantity: number;
  lineTotalAmount: bigint;
  includeFor: IncludeFor[];
  percentage?: Decimal.Value;
}

export interface PriceBreakdown {
  lineItems: ComputedLineItem[];
  payinTotalAmount: bigint; // Σ lines that includeFor customer (what the buyer is charged)
  payoutTotalAmount: bigint; // Σ lines that includeFor provider (what the seller receives, escrowed)
  marginAmount: bigint; // payin − payout (platform take = the Stripe application-fee equivalent)
  currency: string;
}

/** Sharetribe rejects > 50 line items; we must enforce it ourselves now (doc 04). */
export const MAX_LINE_ITEMS = 50;
