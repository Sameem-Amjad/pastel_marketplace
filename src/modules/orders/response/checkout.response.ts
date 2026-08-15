import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger models for the checkout payloads.
 *
 * Every amount is in **minor units** (cents) and computed server-side from the listing price and the
 * platform commission config — the client never sends a total, and a client-supplied total would be
 * ignored (doc 04).
 */

/** One computed price line. */
export class PriceLineResource {
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

  @ApiProperty({ example: 24999, description: 'Line total in minor units.' })
  lineTotalAmount!: number;

  @ApiProperty({
    type: [String],
    example: ['customer'],
    description: 'Which side the line applies to.',
  })
  includeFor!: string[];

  @ApiPropertyOptional({
    example: '-10',
    description: 'Present on commission lines: the percentage applied, as a decimal string.',
  })
  percentage?: string;
}

/** The full price breakdown, safe to render as an order summary. */
export class PriceBreakdownResource {
  @ApiProperty({ type: [PriceLineResource] })
  lineItems!: PriceLineResource[];

  @ApiProperty({ example: 27499, description: 'What the buyer is charged, in minor units.' })
  payinTotalAmount!: number;

  @ApiProperty({ example: 22499, description: 'What the seller receives, in minor units.' })
  payoutTotalAmount!: number;

  @ApiProperty({ example: 5000, description: 'payin − payout: the platform take, in minor units.' })
  marginAmount!: number;

  @ApiProperty({ example: 'GBP', description: 'ISO-4217 currency code.' })
  currency!: string;
}

/** Returned by POST /checkout — the created order plus what the payment sheet needs. */
export class CheckoutResultResource {
  @ApiProperty({ format: 'uuid', description: 'The created order.' })
  orderId!: string;

  @ApiProperty({ example: 'preauthorized', description: 'Order state after preauthorisation.' })
  state!: string;

  @ApiProperty({
    example: 'pi_3abc_secret_xyz',
    nullable: true,
    description:
      'Stripe PaymentIntent client secret. Hand it to the Stripe React Native SDK to collect payment, then call POST /checkout/confirm.',
  })
  clientSecret!: string | null;

  @ApiProperty({ type: PriceBreakdownResource, description: 'Snapshot of the agreed price.' })
  breakdown!: PriceBreakdownResource;
}

/** Returned by POST /checkout/confirm. */
export class ConfirmResultResource {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'purchased', description: 'Order state after capture.' })
  state!: string;
}
