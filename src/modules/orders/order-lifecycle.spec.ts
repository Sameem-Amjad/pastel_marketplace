import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { CheckoutService } from './checkout.service';
import { FakePaymentGateway } from './gateway/fake-payment-gateway';
import { OrderStateMachine } from './order-state-machine.service';

/**
 * Integration test: drives a real order through the full instant-purchase lifecycle against the live
 * Postgres `pastel_dev` DB, using the in-memory payment gateway. Validates state guards, the escrow
 * payout boundary, scheduled-timer reconciliation, and the immutable transition log.
 *
 * Run: DATABASE_URL=postgresql://localhost:5432/pastel_dev npx jest order-lifecycle
 */
describe('Order lifecycle (instant-purchase)', () => {
  const prisma = new PrismaService();
  const fsm = new OrderStateMachine(prisma, new PricingService(), new OutboxService(), new FakePaymentGateway());
  const checkout = new CheckoutService(prisma, new PricingService(), fsm);

  const suffix = Date.now();
  let customerId: string;
  let providerId: string;
  let listingId: string;
  let orderId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.commissionConfig.upsert({
      where: { id: 1 },
      create: { id: 1, providerPercentage: new Prisma.Decimal('10'), customerPercentage: new Prisma.Decimal('0') },
      update: { providerPercentage: new Prisma.Decimal('10'), customerPercentage: new Prisma.Decimal('0') },
    });
    const customer = await prisma.user.create({ data: { email: `buyer${suffix}@t.com`, updatedAt: new Date() } });
    const provider = await prisma.user.create({ data: { email: `seller${suffix}@t.com`, userType: 'seller', updatedAt: new Date() } });
    customerId = customer.id;
    providerId = provider.id;
    await prisma.stripeAccount.create({
      data: { userId: providerId, stripeAccountId: `acct_test_${suffix}`, status: 'enabled', payoutsEnabled: true },
    });
    const listing = await prisma.listing.create({
      data: {
        authorId: providerId,
        title: 'Test artisan bowl',
        state: 'published',
        priceAmount: 5000n,
        priceCurrency: 'USD',
        shipOneItemAmount: 800n,
        deliveryMethod: 'shipping',
        stockQuantity: 5,
        publishedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    listingId = listing.id;
  });

  afterAll(async () => {
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.stripeAccount.deleteMany({ where: { userId: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [customerId, providerId] } } });
    await prisma.$disconnect();
  });

  it('checkout computes server-authoritative totals and creates a PaymentIntent', async () => {
    const res = await checkout.checkout(customerId, { listingId, quantity: 1 });
    orderId = res.orderId;
    expect(res.state).toBe('pending-payment');
    expect(res.clientSecret).toMatch(/pi_fake_/);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    // item 5000 + shipping 800 = 5800 payin; payout = 5800 − 10% commission(500) = 5300
    expect(order.payinTotalAmount).toBe(5800n);
    expect(order.payoutTotalAmount).toBe(5300n);

    // a PT15M expire-payment timer was scheduled
    const timers = await prisma.scheduledTransition.findMany({ where: { orderId, status: 'pending' } });
    expect(timers).toHaveLength(1);
    expect(timers[0].transition).toBe('expire-payment');
  });

  it('enforces guards: state-before-actor (doc 04 §1.3)', async () => {
    // Wrong actor on a state-valid transition → 403. (expire-payment is valid from pending-payment,
    // but only 'system' may invoke it.)
    await expect(fsm.apply(orderId, 'expire-payment', 'customer', {})).rejects.toBeInstanceOf(ForbiddenException);
    // Valid actor, wrong state → 409. (provider may confirm-order, but only from 'purchased'.)
    await expect(fsm.apply(orderId, 'confirm-order', 'provider', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('drives the happy path to completed and releases escrow exactly at receipt', async () => {
    await checkout.confirm(customerId, orderId); // → purchased (capture)
    let order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe('purchased');
    expect(order.payoutReleased).toBe(false); // escrow still held

    await fsm.apply(orderId, 'confirm-order', 'provider', {});
    await fsm.apply(orderId, 'mark-shipped', 'provider', {});
    await fsm.apply(orderId, 'mark-delivered', 'provider', {});
    order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe('delivered');
    expect(order.payoutReleased).toBe(false); // STILL held right up to receipt

    await fsm.apply(orderId, 'mark-received', 'customer', {}); // → received → (immediate) completed
    order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe('completed');
    expect(order.payoutReleased).toBe(true); // escrow released
    expect(order.payoutReleasedAt).not.toBeNull();

    const payout = await prisma.payout.findUniqueOrThrow({ where: { orderId } });
    expect(payout.status).toBe('paid');
    expect(payout.amount).toBe(5300n);
    expect(payout.stripeTransferId).toMatch(/tr_fake_/);
  });

  it('logged every transition immutably and left a single live timer', async () => {
    const transitions = await prisma.orderTransition.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    const names = transitions.map((t) => t.transition);
    expect(names).toEqual([
      'request-payment',
      'confirm-payment',
      'confirm-order',
      'mark-shipped',
      'mark-delivered',
      'mark-received',
      'mark-completed',
    ]);

    // All superseded timers canceled; only the completed-state review timer (P7D) remains pending.
    const pending = await prisma.scheduledTransition.findMany({ where: { orderId, status: 'pending' } });
    expect(pending).toHaveLength(1);
    expect(pending[0].transition).toBe('expire-review-period');
  });
});
