import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OutboxService, OutboxTopic } from '../../../common/outbox/outbox.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { PriceInput } from '../../pricing/entities/pricing.types';
import { PAYMENT_GATEWAY, PaymentGateway } from '../gateway/payment-gateway.interface';
import { OrderResponseMessage } from '../response/response-message';
import { INSTANT_PURCHASE } from '../process/instant-purchase.process';
import { Actor, durationToMs, ProcessDefinition, TransitionDef } from '../process/process.types';

const REGISTRY: Record<string, ProcessDefinition> = {
  [INSTANT_PURCHASE.alias]: INSTANT_PURCHASE,
};

export interface ApplyOpts {
  actorUserId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * The transaction engine (doc 04 §1.3). Every transition runs in ONE DB transaction:
 *   1. row-lock the order (SELECT … FOR UPDATE)
 *   2. assert order.state ∈ transition.from        → else 409
 *   3. assert actor allowed                          → else 403
 *   4. recompute line items server-side if privileged (never trust prior/client totals)
 *   5. run the idempotent money action (Stripe via the gateway)
 *   6. append an immutable OrderTransition row
 *   7. update state/totals; flip payoutReleased on payout (the irreversibility boundary)
 *   8. reconcile timers: cancel pending ScheduledTransitions, schedule the new state's timer
 *   9. emit order.transitioned to the outbox (same tx)
 * Stripe failure throws → the whole tx rolls back → no half-applied state.
 */
@Injectable()
export class OrderStateMachine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly outbox: OutboxService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async apply(
    orderId: string,
    transitionName: string,
    actor: Actor,
    opts: ApplyOpts = {},
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      // 1. lock
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
      return this.executeWithin(tx, orderId, transitionName, actor, opts);
    });
  }

  private async executeWithin(
    tx: Prisma.TransactionClient,
    orderId: string,
    transitionName: string,
    actor: Actor,
    opts: ApplyOpts,
  ): Promise<Order> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(OrderResponseMessage.fail.ORDER_NOT_FOUND);

    const def = REGISTRY[order.processAlias];
    if (!def) throw new BadRequestException(`Unknown process ${order.processAlias}`);
    const t = def.transitions.find((x) => x.name === transitionName);
    if (!t) throw new BadRequestException(`Unknown transition ${transitionName}`);

    // 2 + 3. guards
    if (!t.from.includes(order.state)) {
      throw new ConflictException(`Cannot ${transitionName} from state ${order.state}`);
    }
    if (!t.actor.includes(actor)) {
      throw new ForbiddenException(`${actor} may not ${transitionName}`);
    }

    // 4. privileged recompute (server-authoritative)
    let totals: { payin: bigint; payout: bigint } | null = null;
    if (t.privileged) {
      totals = await this.recompute(tx, order);
    }

    // 5. money action
    await this.runAction(tx, order, t, totals);

    // 6. audit row
    await tx.orderTransition.create({
      data: {
        orderId,
        transition: transitionName,
        fromState: order.state,
        toState: t.to,
        actor,
        actorUserId: opts.actorUserId,
        metadata: opts.metadata ?? {},
      },
    });

    // 7. advance state (+ payout boundary on payout action)
    const data: Prisma.OrderUpdateInput = {
      state: t.to,
      lastTransition: transitionName,
      lastTransitionedAt: new Date(),
    };
    if (totals) {
      data.payinTotalAmount = totals.payin;
      data.payoutTotalAmount = totals.payout;
    }
    if (t.action === 'payout') {
      data.payoutReleased = true;
      data.payoutReleasedAt = new Date();
    }
    let updated = await tx.order.update({ where: { id: orderId }, data });

    // 8. reconcile timers
    await tx.scheduledTransition.updateMany({
      where: { orderId, status: 'pending' },
      data: { status: 'canceled' },
    });
    const timer = def.stateTimers?.[t.to];
    if (timer) {
      await tx.scheduledTransition.create({
        data: {
          orderId,
          transition: timer.transition,
          guardState: t.to,
          runAt: new Date(Date.now() + durationToMs(timer.after)),
        },
      });
    }

    // 9. outbox
    await this.outbox.emit(tx, OutboxTopic.OrderTransitioned, {
      orderId,
      transition: transitionName,
      fromState: order.state,
      toState: t.to,
    });
    if (t.action === 'payout') {
      await this.outbox.emit(tx, OutboxTopic.PayoutReleased, { orderId });
    }

    // immediate auto-advance (received → completed)
    const next = def.immediateNext?.[t.to];
    if (next) {
      updated = await this.executeWithin(tx, orderId, next, 'system', {});
    }
    return updated;
  }

  private async recompute(
    tx: Prisma.TransactionClient,
    order: Order,
  ): Promise<{ payin: bigint; payout: bigint }> {
    const snapshot = (order.metadata as Record<string, unknown> | null)?.priceInput;
    if (!snapshot) {
      return { payin: order.payinTotalAmount, payout: order.payoutTotalAmount };
    }
    const input = this.coercePriceInput(snapshot as Record<string, unknown>);
    const breakdown = this.pricing.compute(input);

    // Replace line items with the freshly computed (non-reversal) set.
    await tx.lineItem.deleteMany({ where: { orderId: order.id, reversal: false } });
    await tx.lineItem.createMany({
      data: breakdown.lineItems.map((l) => ({
        orderId: order.id,
        code: l.code,
        unitPriceAmount: l.unitPriceAmount,
        currency: breakdown.currency,
        quantity: l.quantity,
        percentage: l.percentage === undefined ? null : new Prisma.Decimal(String(l.percentage)),
        lineTotalAmount: l.lineTotalAmount,
        includeFor: l.includeFor,
      })),
    });
    return { payin: breakdown.payinTotalAmount, payout: breakdown.payoutTotalAmount };
  }

  private async runAction(
    tx: Prisma.TransactionClient,
    order: Order,
    t: TransitionDef,
    totals: { payin: bigint; payout: bigint } | null,
  ): Promise<void> {
    const payin = totals?.payin ?? order.payinTotalAmount;
    const payout = totals?.payout ?? order.payoutTotalAmount;

    switch (t.action) {
      case undefined:
        return;

      case 'create-payment-intent': {
        const customer = await tx.stripeCustomer.findUnique({
          where: { userId: order.customerId },
        });
        const res = await this.gateway.createPaymentIntent({
          orderId: order.id,
          amount: payin,
          currency: order.currency,
          customerStripeId: customer?.stripeCustomerId,
        });
        await tx.paymentIntent.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            stripePiId: res.stripePiId,
            clientSecret: res.clientSecret,
            amount: payin,
            currency: order.currency,
            applicationFeeAmount: payin - payout,
            status: res.status,
          },
          update: {
            stripePiId: res.stripePiId,
            clientSecret: res.clientSecret,
            amount: payin,
            status: res.status,
          },
        });
        return;
      }

      case 'confirm-capture': {
        const pi = await tx.paymentIntent.findUnique({ where: { orderId: order.id } });
        if (!pi) throw new ConflictException('No payment intent to confirm');
        const res = await this.gateway.confirmAndCapture(pi.stripePiId);
        await tx.paymentIntent.update({
          where: { orderId: order.id },
          data: { status: res.status, capturedAt: new Date() },
        });
        return;
      }

      case 'cancel-payment-intent': {
        const pi = await tx.paymentIntent.findUnique({ where: { orderId: order.id } });
        if (pi) {
          await this.gateway.cancelPaymentIntent(pi.stripePiId);
          await tx.paymentIntent.update({
            where: { orderId: order.id },
            data: { status: 'canceled' },
          });
        }
        return;
      }

      case 'payout': {
        if (order.payoutReleased) return; // CAS: never pay out twice
        const account = await tx.stripeAccount.findUnique({ where: { userId: order.providerId } });
        if (!account) throw new ConflictException('Seller has no connected Stripe account');
        const res = await this.gateway.createTransfer({
          orderId: order.id,
          amount: payout,
          currency: order.currency,
          destinationAccountId: account.stripeAccountId,
        });
        await tx.payout.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            stripeTransferId: res.stripeTransferId,
            destinationAccountId: account.stripeAccountId,
            amount: payout,
            currency: order.currency,
            status: 'paid',
            releasedAt: new Date(),
          },
          update: {
            stripeTransferId: res.stripeTransferId,
            status: 'paid',
            releasedAt: new Date(),
          },
        });
        return;
      }

      case 'refund-full': {
        const pi = await tx.paymentIntent.findUnique({ where: { orderId: order.id } });
        if (!pi) return;
        const res = await this.gateway.refund({
          orderId: order.id,
          stripePiId: pi.stripePiId,
          amount: payin,
          currency: order.currency,
        });
        await tx.refund.create({
          data: {
            orderId: order.id,
            stripeRefundId: res.stripeRefundId,
            mode: 'full',
            resolution: 'refund',
            amount: payin,
            currency: order.currency,
            actor: 'system',
          },
        });
        return;
      }
    }
  }

  private coercePriceInput(s: Record<string, unknown>): PriceInput {
    const big = (v: unknown): bigint | undefined =>
      v === undefined || v === null ? undefined : BigInt(v as number);
    const items = (s.items as { unitPriceAmount: number; quantity: number }[]).map((i) => ({
      unitPriceAmount: BigInt(i.unitPriceAmount),
      quantity: i.quantity,
    }));
    const commission = s.commission as { providerPercentage: string; customerPercentage: string };
    return {
      currency: s.currency as string,
      items,
      commission,
      pickup: s.pickup as boolean | undefined,
      shippingFeeAmount: big(s.shippingFeeAmount),
      shippingDiscountAmount: big(s.shippingDiscountAmount),
      taxAmount: big(s.taxAmount),
      taxIncludeFor: s.taxIncludeFor as 'customer' | 'provider' | undefined,
      promoDiscountAmount: big(s.promoDiscountAmount),
    };
  }
}
