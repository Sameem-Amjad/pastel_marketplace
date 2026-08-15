import { BadRequestException, Injectable } from '@nestjs/common';
import { IncludeFor, LineItemCode } from '@prisma/client';
import Decimal from 'decimal.js';
import { Money } from '../../../common/money/money';
import {
  ComputedLineItem,
  MAX_LINE_ITEMS,
  PriceBreakdown,
  PriceInput,
} from '../entities/pricing.types';

const BOTH: IncludeFor[] = ['customer', 'provider'];
const CUSTOMER: IncludeFor[] = ['customer'];
const PROVIDER: IncludeFor[] = ['provider'];

/**
 * Pricing engine — the financial trust boundary (doc 04 §2).
 *
 * Pure and deterministic: same input → same line items, to the cent. No DB, no I/O, no clock. The server
 * ALWAYS recomputes this (at checkout AND at every privileged transition); a client-supplied total is
 * never trusted.
 *
 * The `includeFor` model is the whole game:
 *   payin  = Σ lineTotal where includeFor ∋ customer   (what the buyer is charged)
 *   payout = Σ lineTotal where includeFor ∋ provider   (what the seller receives, held in escrow)
 *   margin = payin − payout                            (platform take)
 * Commission base is the ITEM SUBTOTAL only — shipping is never commissioned.
 */
@Injectable()
export class PricingService {
  compute(input: PriceInput): PriceBreakdown {
    const { currency } = input;
    if (input.items.length === 0) throw new BadRequestException('No items to price');

    const lines: ComputedLineItem[] = [];

    // 1) Item lines — buyer pays, seller receives (commission adjusts below).
    let itemSubtotal = Money.zero(currency);
    for (const it of input.items) {
      if (it.quantity <= 0) throw new BadRequestException('Quantity must be positive');
      const unit = Money.fromMinor(it.unitPriceAmount, currency);
      const lineTotal = unit.times(it.quantity);
      itemSubtotal = itemSubtotal.add(lineTotal);
      lines.push(this.line(LineItemCode.item, unit, it.quantity, lineTotal, BOTH));
    }

    // 2) Shipping (or pickup). Buyer pays it, seller receives it.
    if (input.pickup) {
      lines.push(this.line(LineItemCode.pickup_fee, Money.zero(currency), 1, Money.zero(currency), BOTH));
    } else if (input.shippingFeeAmount && input.shippingFeeAmount > 0n) {
      const fee = Money.fromMinor(input.shippingFeeAmount, currency);
      lines.push(this.line(LineItemCode.shipping_fee, fee, 1, fee, BOTH));
    }
    if (input.shippingDiscountAmount && input.shippingDiscountAmount > 0n) {
      const disc = Money.fromMinor(input.shippingDiscountAmount, currency).negate();
      lines.push(this.line(LineItemCode.shipping_discount, disc, 1, disc, BOTH));
    }

    // 3) Provider commission — withheld from payout (negative, provider-only). Base = item subtotal.
    const providerPct = new Decimal(input.commission.providerPercentage);
    if (providerPct.gt(0)) {
      const amount = itemSubtotal.percentage(providerPct).negate();
      lines.push(this.line(LineItemCode.provider_commission, amount, 1, amount, PROVIDER, providerPct));
    }

    // 4) Customer commission — added to payin (positive, customer-only). Base = item subtotal.
    const customerPct = new Decimal(input.commission.customerPercentage);
    if (customerPct.gt(0)) {
      const amount = itemSubtotal.percentage(customerPct);
      lines.push(this.line(LineItemCode.customer_commission, amount, 1, amount, CUSTOMER, customerPct));
    }

    // 5) Sales tax. Default: customer pays it on top (positive, payin). localTaxes: WITHHELD from the
    //    seller payout — the seller is merchant-of-record, buyer isn't charged extra, so the line is
    //    NEGATIVE on a provider-only line (reduces payout; platform holds it to remit).
    if (input.taxAmount && input.taxAmount > 0n) {
      const tax = Money.fromMinor(input.taxAmount, currency);
      if (input.taxIncludeFor === 'provider') {
        const withheld = tax.negate();
        lines.push(this.line(LineItemCode.sales_tax, withheld, 1, withheld, PROVIDER));
      } else {
        lines.push(this.line(LineItemCode.sales_tax, tax, 1, tax, CUSTOMER));
      }
    }

    // 6) App promo — platform-funded; reduces buyer payin only.
    if (input.promoDiscountAmount && input.promoDiscountAmount > 0n) {
      const promo = Money.fromMinor(input.promoDiscountAmount, currency).negate();
      lines.push(this.line(LineItemCode.app_promo_discount, promo, 1, promo, CUSTOMER));
    }

    if (lines.length > MAX_LINE_ITEMS) {
      throw new BadRequestException(`Too many line items (${lines.length} > ${MAX_LINE_ITEMS})`);
    }

    return this.totals(lines, currency);
  }

  /** Recompute payin/payout/margin from an arbitrary set of lines (also used after refund reversals). */
  totals(lines: ComputedLineItem[], currency: string): PriceBreakdown {
    const payin = lines
      .filter((l) => l.includeFor.includes('customer'))
      .reduce((acc, l) => acc.add(Money.fromMinor(l.lineTotalAmount, currency)), Money.zero(currency));
    const payout = lines
      .filter((l) => l.includeFor.includes('provider'))
      .reduce((acc, l) => acc.add(Money.fromMinor(l.lineTotalAmount, currency)), Money.zero(currency));
    return {
      lineItems: lines,
      payinTotalAmount: payin.amount,
      payoutTotalAmount: payout.amount,
      marginAmount: payin.subtract(payout).amount,
      currency,
    };
  }

  private line(
    code: LineItemCode,
    unit: Money,
    quantity: number,
    lineTotal: Money,
    includeFor: IncludeFor[],
    percentage?: Decimal.Value,
  ): ComputedLineItem {
    return {
      code,
      unitPriceAmount: unit.amount,
      quantity,
      lineTotalAmount: lineTotal.amount,
      includeFor,
      percentage,
    };
  }
}
