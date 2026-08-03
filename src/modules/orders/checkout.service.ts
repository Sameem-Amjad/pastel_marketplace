import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { PriceBreakdown, PriceInput } from '../pricing/pricing.types';
import { OrderStateMachine } from './order-state-machine.service';

export interface CheckoutInput {
  listingId: string;
  quantity: number;
}

export interface CheckoutResult {
  orderId: string;
  state: string;
  clientSecret: string | null;
  breakdown: PriceBreakdown;
}

/**
 * Checkout orchestration (doc 04 §1.1, doc 06):
 *   speculate → compute price breakdown only, no side effects (the preview)
 *   checkout  → create order in `initial` + apply privileged request-payment (creates the PaymentIntent)
 *   confirm   → apply confirm-payment (capture to platform escrow)
 *
 * The price is always built here from server data (listing price, commission config) — never accepted
 * from the client. The same PriceInput is snapshotted on the order so privileged transitions recompute
 * identically.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fsm: OrderStateMachine,
  ) {}

  async speculate(input: CheckoutInput): Promise<PriceBreakdown> {
    const { priceInput } = await this.buildPriceInput(input);
    return this.pricing.compute(priceInput);
  }

  async checkout(customerId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const { providerId, priceInput, snapshot } = await this.buildPriceInput(input);
    if (providerId === customerId) throw new BadRequestException('Cannot buy your own listing');

    const breakdown = this.pricing.compute(priceInput);

    const order = await this.prisma.order.create({
      data: {
        processAlias: 'instant-purchase/release-14',
        processName: 'instant_purchase',
        state: 'initial',
        customerId,
        providerId,
        listingId: input.listingId,
        currency: priceInput.currency,
        payinTotalAmount: 0n,
        payoutTotalAmount: 0n,
        metadata: { priceInput: snapshot } as Prisma.InputJsonValue,
      },
    });

    // Privileged: recomputes line items + totals server-side and creates the PaymentIntent.
    await this.fsm.apply(order.id, 'request-payment', 'customer', { actorUserId: customerId });

    const pi = await this.prisma.paymentIntent.findUnique({ where: { orderId: order.id } });
    const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    return { orderId: order.id, state: fresh.state, clientSecret: pi?.clientSecret ?? null, breakdown };
  }

  async confirm(customerId: string, orderId: string): Promise<{ orderId: string; state: string }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) throw new BadRequestException('Not your order');
    const updated = await this.fsm.apply(orderId, 'confirm-payment', 'customer', { actorUserId: customerId });
    return { orderId, state: updated.state };
  }

  /** Builds the server-authoritative PriceInput (and a JSON-safe snapshot) for a listing purchase. */
  private async buildPriceInput(
    input: CheckoutInput,
  ): Promise<{ providerId: string; priceInput: PriceInput; snapshot: Record<string, unknown> }> {
    if (input.quantity <= 0) throw new BadRequestException('Quantity must be positive');
    const listing = await this.prisma.listing.findFirst({
      where: { id: input.listingId, state: 'published', deletedAt: null },
    });
    if (!listing) throw new NotFoundException('Listing not available');
    if (listing.priceAmount === null || !listing.priceCurrency) {
      throw new BadRequestException('Listing has no price');
    }

    const commission = (await this.prisma.commissionConfig.findUnique({ where: { id: 1 } })) ?? {
      providerPercentage: new Prisma.Decimal(0),
      customerPercentage: new Prisma.Decimal(0),
    };

    const shippingFee = listing.shipOneItemAmount ?? 0n;
    const snapshot: Record<string, unknown> = {
      currency: listing.priceCurrency,
      items: [{ unitPriceAmount: Number(listing.priceAmount), quantity: input.quantity }],
      commission: {
        providerPercentage: commission.providerPercentage.toString(),
        customerPercentage: commission.customerPercentage.toString(),
      },
      pickup: listing.deliveryMethod === 'pickup',
      shippingFeeAmount: listing.deliveryMethod === 'pickup' ? undefined : Number(shippingFee),
    };

    const priceInput: PriceInput = {
      currency: listing.priceCurrency,
      items: [{ unitPriceAmount: listing.priceAmount, quantity: input.quantity }],
      commission: {
        providerPercentage: commission.providerPercentage.toString(),
        customerPercentage: commission.customerPercentage.toString(),
      },
      pickup: listing.deliveryMethod === 'pickup',
      shippingFeeAmount: listing.deliveryMethod === 'pickup' ? undefined : shippingFee,
    };
    return { providerId: listing.authorId, priceInput, snapshot };
  }
}
