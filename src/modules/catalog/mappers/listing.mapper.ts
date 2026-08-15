import { ApiProperty } from '@nestjs/swagger';
import { Listing } from '@prisma/client';

/**
 * Public listing projection. `privateData`/`metadata` never leave the server.
 *
 * Declared as a class so Swagger can introspect it; `toListingResource` returns a plain object that
 * structurally satisfies the type.
 */
export class ListingResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Id of the seller who owns this listing.' })
  authorId!: string;

  @ApiProperty({ example: 'Mid-century teak sideboard' })
  title!: string;

  @ApiProperty({ example: 'Restored 1960s Danish sideboard in walnut.', nullable: true })
  description!: string | null;

  @ApiProperty({
    example: 'published',
    description: 'One of `draft`, `pendingApproval`, `published`, `closed`.',
  })
  state!: string;

  @ApiProperty({
    example: 24999,
    nullable: true,
    description: 'Price in **minor units** (cents). 24999 = £249.99.',
  })
  priceAmount!: number | null;

  @ApiProperty({ example: 'GBP', nullable: true, description: 'ISO-4217 currency code.' })
  priceCurrency!: string | null;

  @ApiProperty({ example: 'product', description: 'Listing type alias (drives the buy flow).' })
  listingType!: string;

  @ApiProperty({ example: 'Furniture', nullable: true })
  categoryL1!: string | null;

  @ApiProperty({ example: 'Storage', nullable: true })
  categoryL2!: string | null;

  @ApiProperty({ example: 'Sideboards', nullable: true })
  categoryL3!: string | null;

  @ApiProperty({ example: 'good', nullable: true })
  condition!: string | null;

  @ApiProperty({ example: '1960s', nullable: true })
  period!: string | null;

  @ApiProperty({ example: 'Denmark', nullable: true })
  origin!: string | null;

  @ApiProperty({ type: [String], example: ['teak', 'brass'] })
  materials!: string[];

  @ApiProperty({ example: 'oneItem', description: 'Stock model: `oneItem`, `multipleItems`, ...' })
  stockType!: string;

  @ApiProperty({ example: 1 })
  stockQuantity!: number;

  @ApiProperty({
    example: 3,
    description: 'Optimistic-lock counter. Send it as `expectedVersion` when updating stock.',
  })
  stockVersion!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Client-owned public extended data (images, dimensions, ...).',
  })
  publicData!: unknown;

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-08-14T12:00:00.000Z' })
  publishedAt!: Date | null;
}

export function toListingResource(l: Listing): ListingResource {
  return {
    id: l.id,
    authorId: l.authorId,
    title: l.title,
    description: l.description,
    state: l.state,
    priceAmount: l.priceAmount === null ? null : Number(l.priceAmount),
    priceCurrency: l.priceCurrency,
    listingType: l.listingType,
    categoryL1: l.categoryL1,
    categoryL2: l.categoryL2,
    categoryL3: l.categoryL3,
    condition: l.condition,
    period: l.period,
    origin: l.origin,
    materials: l.materials,
    stockType: l.stockType,
    stockQuantity: l.stockQuantity,
    stockVersion: l.stockVersion,
    publicData: l.publicData,
    createdAt: l.createdAt,
    publishedAt: l.publishedAt,
  };
}
