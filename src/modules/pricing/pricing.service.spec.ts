import { PricingService } from './pricing.service';

describe('PricingService', () => {
  const svc = new PricingService();

  it('computes payin/payout/margin with commission, shipping, and tax', () => {
    // $45.00 item, 8.5% provider commission, $8.00 shipping, $3.83 tax (customer).
    const b = svc.compute({
      currency: 'USD',
      items: [{ unitPriceAmount: 4500n, quantity: 1 }],
      commission: { providerPercentage: '8.5', customerPercentage: '0' },
      shippingFeeAmount: 800n,
      taxAmount: 383n,
      taxIncludeFor: 'customer',
    });

    // payin  = item 4500 + shipping 800 + tax 383            = 5683
    // payout = item 4500 + shipping 800 − commission 383     = 4917
    // margin = commission 383 + tax 383                      = 766
    expect(b.payinTotalAmount).toBe(5683n);
    expect(b.payoutTotalAmount).toBe(4917n);
    expect(b.marginAmount).toBe(766n);

    const commission = b.lineItems.find((l) => l.code === 'provider_commission')!;
    expect(commission.lineTotalAmount).toBe(-383n); // 8.5% of 4500 = 382.5 → 383 HALF_UP, negative
    expect(commission.includeFor).toEqual(['provider']);
  });

  it('commission base is the item subtotal only — never shipping', () => {
    const b = svc.compute({
      currency: 'USD',
      items: [{ unitPriceAmount: 10_000n, quantity: 2 }], // 20000 subtotal
      commission: { providerPercentage: '10', customerPercentage: '0' },
      shippingFeeAmount: 5000n,
    });
    const commission = b.lineItems.find((l) => l.code === 'provider_commission')!;
    expect(commission.lineTotalAmount).toBe(-2000n); // 10% of 20000, NOT of 25000
  });

  it('customer commission adds to payin only', () => {
    const b = svc.compute({
      currency: 'USD',
      items: [{ unitPriceAmount: 1000n, quantity: 1 }],
      commission: { providerPercentage: '0', customerPercentage: '5' },
    });
    expect(b.payinTotalAmount).toBe(1050n); // 1000 + 50
    expect(b.payoutTotalAmount).toBe(1000n); // unaffected
    expect(b.marginAmount).toBe(50n);
  });

  it('localTaxes withholds tax from the seller payout instead of charging the buyer', () => {
    const b = svc.compute({
      currency: 'USD',
      items: [{ unitPriceAmount: 1000n, quantity: 1 }],
      commission: { providerPercentage: '0', customerPercentage: '0' },
      taxAmount: 80n,
      taxIncludeFor: 'provider',
    });
    expect(b.payinTotalAmount).toBe(1000n); // buyer not charged tax
    expect(b.payoutTotalAmount).toBe(920n); // tax withheld from seller (1000 − 80)
    expect(b.marginAmount).toBe(80n); // platform holds the tax to remit
  });

  it('app promo reduces buyer payin but not seller payout', () => {
    const b = svc.compute({
      currency: 'USD',
      items: [{ unitPriceAmount: 2000n, quantity: 1 }],
      commission: { providerPercentage: '0', customerPercentage: '0' },
      promoDiscountAmount: 500n,
    });
    expect(b.payinTotalAmount).toBe(1500n); // 2000 − 500
    expect(b.payoutTotalAmount).toBe(2000n); // platform eats the promo
    expect(b.marginAmount).toBe(-500n);
  });

  it('pickup adds a zero pickup_fee and no shipping', () => {
    const b = svc.compute({
      currency: 'USD',
      items: [{ unitPriceAmount: 1000n, quantity: 1 }],
      commission: { providerPercentage: '0', customerPercentage: '0' },
      pickup: true,
      shippingFeeAmount: 999n, // ignored for pickup
    });
    expect(b.lineItems.some((l) => l.code === 'pickup_fee')).toBe(true);
    expect(b.lineItems.some((l) => l.code === 'shipping_fee')).toBe(false);
    expect(b.payinTotalAmount).toBe(1000n);
  });

  it('rejects empty carts and non-positive quantities', () => {
    expect(() => svc.compute({ currency: 'USD', items: [], commission: { providerPercentage: '0', customerPercentage: '0' } })).toThrow();
    expect(() =>
      svc.compute({
        currency: 'USD',
        items: [{ unitPriceAmount: 100n, quantity: 0 }],
        commission: { providerPercentage: '0', customerPercentage: '0' },
      }),
    ).toThrow();
  });
});
