/**
 * PaymentGateway — the seam between the order state machine and Stripe (doc 04 §3).
 *
 * The FSM never imports the Stripe SDK directly; it depends on this interface. That keeps the
 * money-movement logic unit-testable with FakePaymentGateway and lets the real Stripe Connect
 * implementation be swapped/mocked. Escrow = separate charges + transfers: capture to the platform
 * balance now, transfer to the seller's connected account only at receipt.
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CreateIntentParams {
  orderId: string;
  amount: bigint; // payin total, minor units
  currency: string;
  customerStripeId?: string | null;
  paymentMethodId?: string | null;
}

export interface IntentResult {
  stripePiId: string;
  clientSecret: string | null;
  status: string;
}

export interface TransferParams {
  orderId: string;
  amount: bigint; // payout total, minor units
  currency: string;
  destinationAccountId: string;
}

export interface RefundParams {
  orderId: string;
  stripePiId: string;
  amount: bigint; // minor units
  currency: string;
}

export interface PaymentGateway {
  createPaymentIntent(p: CreateIntentParams): Promise<IntentResult>;
  /** Confirm (if needed) + capture funds to the platform balance. */
  confirmAndCapture(stripePiId: string): Promise<IntentResult>;
  cancelPaymentIntent(stripePiId: string): Promise<void>;
  /** Escrow release: platform balance → seller connected account. */
  createTransfer(p: TransferParams): Promise<{ stripeTransferId: string }>;
  refund(p: RefundParams): Promise<{ stripeRefundId: string }>;
}
