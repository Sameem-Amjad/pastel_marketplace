import Decimal from 'decimal.js';

/**
 * Money — the financial trust boundary (doc 01 §5.2, doc 04 §2).
 *
 * Invariants enforced everywhere money is touched:
 *   - amount is ALWAYS integer minor units (cents), held as bigint. Never a float.
 *   - all arithmetic goes through decimal.js and rounds HALF_UP to whole minor units.
 *   - currency is carried on every value; mixing currencies throws.
 *
 * Wire shape is Sharetribe-compatible: { amount: <minor units int>, currency } (doc 06).
 */

// decimal.js configured for monetary math: HALF_UP (a.k.a. ROUND_HALF_UP) rounding.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// Minor-unit exponent per ISO-4217 currency. Default is 2 (cents). Zero-decimal currencies listed.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'XAF', 'XOF', 'BIF', 'PYG']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'TND', 'JOD']);

export function subunitExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

export interface MoneyJSON {
  amount: number; // minor units — fits in a JS number well within Number.MAX_SAFE_INTEGER for realistic totals
  currency: string;
}

export class Money {
  readonly amount: bigint; // minor units
  readonly currency: string;

  private constructor(amount: bigint, currency: string) {
    this.amount = amount;
    this.currency = currency.toUpperCase();
  }

  /** Construct from integer minor units (the canonical/storage form). */
  static fromMinor(amount: bigint | number, currency: string): Money {
    const a = typeof amount === 'bigint' ? amount : BigInt(Math.trunc(amount));
    return new Money(a, currency);
  }

  /** Construct from a major-unit decimal (e.g. "15.99" USD → 1599 cents). Rounds HALF_UP. */
  static fromMajor(value: Decimal.Value, currency: string): Money {
    const exp = subunitExponent(currency);
    const minor = new Decimal(value).times(new Decimal(10).pow(exp)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return new Money(BigInt(minor.toFixed(0)), currency);
  }

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  /** Multiply by an integer quantity (exact). */
  times(quantity: number): Money {
    if (!Number.isInteger(quantity)) {
      throw new Error('Money.times expects an integer quantity; use percentage() for fractional math');
    }
    return new Money(this.amount * BigInt(quantity), this.currency);
  }

  /** Take a percentage of this amount, rounding HALF_UP to whole minor units. e.g. commission lines. */
  percentage(percent: Decimal.Value): Money {
    const result = new Decimal(this.amount.toString())
      .times(new Decimal(percent))
      .dividedBy(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return new Money(BigInt(result.toFixed(0)), this.currency);
  }

  /** Multiply by an arbitrary fraction (e.g. proportional refund), rounding HALF_UP. */
  fraction(f: Decimal.Value): Money {
    const result = new Decimal(this.amount.toString())
      .times(new Decimal(f))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return new Money(BigInt(result.toFixed(0)), this.currency);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amount < other.amount) return -1;
    if (this.amount > other.amount) return 1;
    return 0;
  }

  /** Major-unit string for display/logging only — never for further math. */
  toMajorString(): string {
    const exp = subunitExponent(this.currency);
    return new Decimal(this.amount.toString()).dividedBy(new Decimal(10).pow(exp)).toFixed(exp);
  }

  /** Sharetribe-compatible wire shape (doc 06). */
  toJSON(): MoneyJSON {
    return { amount: Number(this.amount), currency: this.currency };
  }

  /** Sum a list of same-currency Money values. Empty list requires an explicit currency. */
  static sum(items: Money[], currency?: string): Money {
    if (items.length === 0) {
      if (!currency) throw new Error('Money.sum of empty list requires a currency');
      return Money.zero(currency);
    }
    return items.reduce((acc, m) => acc.add(m));
  }
}
