import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LineItem, Order } from '@prisma/client';

/**
 * One priced line of an order. Every amount is in **minor units** (cents) and computed server-side —
 * the client never sends totals (doc 04).
 */
export class LineItemResource {
  @ApiProperty({
    example: 'line-item/item',
    description:
      'Line code: `line-item/item`, `line-item/shipping-fee`, `line-item/commission`, ...',
  })
  code!: string;

  @ApiProperty({ example: 24999, description: 'Unit price in minor units.' })
  unitPriceAmount!: number;

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({ example: 24999, description: 'unitPriceAmount × quantity, in minor units.' })
  lineTotalAmount!: number;

  @ApiProperty({
    type: [String],
    example: ['customer'],
    description: 'Which side(s) this line applies to — drives payin vs payout totals.',
  })
  includeFor!: string[];

  @ApiProperty({
    example: '-10',
    nullable: true,
    description: 'Percentage for commission lines, as a decimal string. Negative withholds.',
  })
  percentage!: string | null;

  @ApiProperty({ example: false, description: 'True on refund/reversal lines.' })
  reversal!: boolean;
}

/** An order (Sharetribe "transaction") and its current state-machine position. */
export class OrderResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({
    example: 'instant-purchase/release-14',
    description: 'Process alias and release.',
  })
  processAlias!: string;

  @ApiProperty({
    example: 'preauthorized',
    description:
      'Current state: `initial`, `preauthorized`, `purchased`, `delivered`, `completed`, ...',
  })
  state!: string;

  @ApiProperty({
    example: 'confirm-payment',
    nullable: true,
    description: 'Last applied transition.',
  })
  lastTransition!: string | null;

  @ApiProperty({ format: 'uuid', description: 'Buyer.' })
  customerId!: string;

  @ApiProperty({ format: 'uuid', description: 'Seller.' })
  providerId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  listingId!: string | null;

  @ApiProperty({ example: 27499, description: 'Total charged to the buyer, in minor units.' })
  payinTotalAmount!: number;

  @ApiProperty({ example: 22499, description: 'Total owed to the seller, in minor units.' })
  payoutTotalAmount!: number;

  @ApiProperty({ example: 'GBP', description: 'ISO-4217 currency code.' })
  currency!: string;

  @ApiProperty({ example: false, description: 'Whether escrow has been released to the seller.' })
  payoutReleased!: boolean;

  @ApiPropertyOptional({
    type: [LineItemResource],
    description: 'Price breakdown. Included on the order detail endpoint only.',
  })
  lineItems?: LineItemResource[];

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;
}

export function toLineItemResource(l: LineItem): LineItemResource {
  return {
    code: l.code,
    unitPriceAmount: Number(l.unitPriceAmount),
    quantity: l.quantity,
    lineTotalAmount: Number(l.lineTotalAmount),
    includeFor: l.includeFor,
    percentage: l.percentage === null ? null : l.percentage.toString(),
    reversal: l.reversal,
  };
}

export function toOrderResource(order: Order, lineItems?: LineItem[]): OrderResource {
  return {
    id: order.id,
    processAlias: order.processAlias,
    state: order.state,
    lastTransition: order.lastTransition,
    customerId: order.customerId,
    providerId: order.providerId,
    listingId: order.listingId,
    payinTotalAmount: Number(order.payinTotalAmount),
    payoutTotalAmount: Number(order.payoutTotalAmount),
    currency: order.currency,
    payoutReleased: order.payoutReleased,
    lineItems: lineItems?.map(toLineItemResource),
    createdAt: order.createdAt,
  };
}
