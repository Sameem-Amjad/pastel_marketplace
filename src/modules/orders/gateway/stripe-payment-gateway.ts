import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  CreateIntentParams,
  IntentResult,
  PaymentGateway,
  RefundParams,
  TransferParams,
} from './payment-gateway.interface';

/**
 * Stripe Connect (Custom) implementation — separate charges + transfers for escrow (doc 04 §2–3).
 *
 *   createPaymentIntent → capture to the PLATFORM balance (transfer_group = orderId)
 *   createTransfer      → release escrow to the seller's connected account at receipt
 *
 * Every money-moving call carries a deterministic idempotency key so retries never double-charge,
 * double-pay, or double-refund (doc 04 §8). Constructed only when STRIPE_SECRET_KEY is set; otherwise
 * the module binds FakePaymentGateway.
 */
@Injectable()
export class StripePaymentGateway implements PaymentGateway {
  private readonly logger = new Logger(StripePaymentGateway.name);
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createPaymentIntent(p: CreateIntentParams): Promise<IntentResult> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: Number(p.amount),
        currency: p.currency.toLowerCase(),
        customer: p.customerStripeId ?? undefined,
        payment_method: p.paymentMethodId ?? undefined,
        capture_method: 'automatic',
        transfer_group: p.orderId,
        metadata: { orderId: p.orderId },
      },
      { idempotencyKey: `pi_${p.orderId}` },
    );
    return { stripePiId: pi.id, clientSecret: pi.client_secret, status: pi.status };
  }

  async confirmAndCapture(stripePiId: string): Promise<IntentResult> {
    // The client confirms 3DS/SCA via stripe.confirmPayment; with automatic capture the PI is already
    // captured by then. If it is still requires_capture (manual flows), capture now.
    let pi = await this.stripe.paymentIntents.retrieve(stripePiId);
    if (pi.status === 'requires_capture') {
      pi = await this.stripe.paymentIntents.capture(stripePiId, undefined, {
        idempotencyKey: `capture_${stripePiId}`,
      });
    }
    return { stripePiId: pi.id, clientSecret: null, status: pi.status };
  }

  async cancelPaymentIntent(stripePiId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(stripePiId).catch((e) => {
      this.logger.warn(`cancel PI ${stripePiId} failed: ${(e as Error).message}`);
    });
  }

  async createTransfer(p: TransferParams): Promise<{ stripeTransferId: string }> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: Number(p.amount),
        currency: p.currency.toLowerCase(),
        destination: p.destinationAccountId,
        transfer_group: p.orderId,
        metadata: { orderId: p.orderId },
      },
      { idempotencyKey: `payout_${p.orderId}` },
    );
    return { stripeTransferId: transfer.id };
  }

  async refund(p: RefundParams): Promise<{ stripeRefundId: string }> {
    const refund = await this.stripe.refunds.create(
      { payment_intent: p.stripePiId, amount: Number(p.amount), metadata: { orderId: p.orderId } },
      { idempotencyKey: `refund_${p.orderId}_${p.amount}` },
    );
    return { stripeRefundId: refund.id };
  }
}
