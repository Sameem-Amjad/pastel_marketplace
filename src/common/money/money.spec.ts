import { Money, subunitExponent } from './money';

describe('Money', () => {
  it('constructs from minor units and round-trips the wire shape', () => {
    const m = Money.fromMinor(1599n, 'usd');
    expect(m.amount).toBe(1599n);
    expect(m.currency).toBe('USD');
    expect(m.toJSON()).toEqual({ amount: 1599, currency: 'USD' });
  });

  it('converts major units HALF_UP', () => {
    expect(Money.fromMajor('15.99', 'USD').amount).toBe(1599n);
    expect(Money.fromMajor('0.005', 'USD').amount).toBe(1n); // HALF_UP rounds .5 up
    expect(Money.fromMajor('0.004', 'USD').amount).toBe(0n);
  });

  it('honors zero-decimal currencies', () => {
    expect(subunitExponent('JPY')).toBe(0);
    expect(Money.fromMajor('1500', 'JPY').amount).toBe(1500n);
    expect(Money.fromMinor(1500n, 'JPY').toMajorString()).toBe('1500');
  });

  it('adds and subtracts within a currency', () => {
    const a = Money.fromMinor(1000n, 'USD');
    const b = Money.fromMinor(250n, 'USD');
    expect(a.add(b).amount).toBe(1250n);
    expect(a.subtract(b).amount).toBe(750n);
  });

  it('refuses to mix currencies', () => {
    const usd = Money.fromMinor(100n, 'USD');
    const eur = Money.fromMinor(100n, 'EUR');
    expect(() => usd.add(eur)).toThrow(/Currency mismatch/);
  });

  it('computes commission percentage HALF_UP', () => {
    // 8.5% of $45.00 = $3.825 -> 383 cents (HALF_UP)
    expect(Money.fromMinor(4500n, 'USD').percentage('8.5').amount).toBe(383n);
  });

  it('computes proportional fractions HALF_UP (partial-refund math)', () => {
    // refund 1/3 of 1000 cents = 333.33 -> 333
    expect(Money.fromMinor(1000n, 'USD').fraction('0.3333').amount).toBe(333n);
  });

  it('multiplies by integer quantity exactly and rejects fractional quantities', () => {
    expect(Money.fromMinor(1599n, 'USD').times(3).amount).toBe(4797n);
    expect(() => Money.fromMinor(1599n, 'USD').times(1.5)).toThrow();
  });

  it('sums a list and requires currency for empty lists', () => {
    const items = [Money.fromMinor(100n, 'USD'), Money.fromMinor(200n, 'USD')];
    expect(Money.sum(items).amount).toBe(300n);
    expect(Money.sum([], 'USD').amount).toBe(0n);
    expect(() => Money.sum([])).toThrow();
  });

  it('compares and detects sign', () => {
    const a = Money.fromMinor(100n, 'USD');
    const b = Money.fromMinor(200n, 'USD');
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(a)).toBe(0);
    expect(a.negate().isNegative()).toBe(true);
    expect(Money.zero('USD').isZero()).toBe(true);
  });
});
