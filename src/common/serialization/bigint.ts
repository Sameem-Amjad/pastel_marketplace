/**
 * BigInt JSON safety.
 *
 * Prisma returns BIGINT columns (money minor units, counters) as JS bigint, which `JSON.stringify`
 * cannot serialize and will throw on. Money realistically stays well under Number.MAX_SAFE_INTEGER
 * (2^53 ≈ 9.0e15 minor units = $90 trillion), so emitting bigints as numbers is safe for our domain and
 * matches the Sharetribe `Money.amount` wire shape (doc 06).
 *
 * Call once at bootstrap, before the HTTP server starts.
 */
export function patchBigIntJson(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function (): number {
    const n = Number(this);
    if (!Number.isSafeInteger(n)) {
      // Surface rather than silently lose precision — should never happen for monetary values.
      throw new Error(`BigInt ${this.toString()} exceeds Number.MAX_SAFE_INTEGER; serialize explicitly`);
    }
    return n;
  };
}
