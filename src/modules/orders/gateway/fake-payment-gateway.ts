import { Injectable } from '@nestjs/common';
import {
  CreateIntentParams,
  IntentResult,
  PaymentGateway,
  RefundParams,
  TransferParams,
} from './payment-gateway.interface';

/**
 * In-memory PaymentGateway for dev/tests. Mirrors the Stripe state transitions deterministically so the
 * order state machine can be validated end-to-end without network/keys. Used when STRIPE_SECRET_KEY is
 * unset (dev) and by the FSM integration tests.
 */
@Injectable()
export class FakePaymentGateway implements PaymentGateway {
  private seq = 0;

  async createPaymentIntent(p: CreateIntentParams): Promise<IntentResult> {
    const id = `pi_fake_${p.orderId.slice(0, 8)}_${++this.seq}`;
    return { stripePiId: id, clientSecret: `${id}_secret`, status: 'requires_confirmation' };
  }

  async confirmAndCapture(stripePiId: string): Promise<IntentResult> {
    return { stripePiId, clientSecret: null, status: 'succeeded' };
  }

  async cancelPaymentIntent(_stripePiId: string): Promise<void> {
    // no-op
  }

  async createTransfer(p: TransferParams): Promise<{ stripeTransferId: string }> {
    return { stripeTransferId: `tr_fake_${p.orderId.slice(0, 8)}_${++this.seq}` };
  }

  async refund(p: RefundParams): Promise<{ stripeRefundId: string }> {
    return { stripeRefundId: `re_fake_${p.orderId.slice(0, 8)}_${++this.seq}` };
  }
}
