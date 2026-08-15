import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Body for POST /listings. The listing is created in `draft` — publish it in a second call. */
export class CreateListingDto {
  @ApiProperty({
    example: 'Mid-century teak sideboard',
    maxLength: 200,
    description: 'Listing title shown on cards and the detail page.',
  })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    example: 'Restored 1960s Danish sideboard in walnut. Minor wear to the top surface.',
    maxLength: 20_000,
    description: 'Long-form description. Supports plain text.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  /** Price in minor units (cents). Server is authoritative; never trusts a computed total. */
  @ApiPropertyOptional({
    example: 24999,
    minimum: 0,
    description:
      'Price in **minor units** (cents) — 24999 means £249.99. Send an integer, never a decimal.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceAmount?: number;

  @ApiPropertyOptional({
    example: 'GBP',
    maxLength: 3,
    description: 'ISO-4217 currency code. Uppercased server-side.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  priceCurrency?: string;

  @ApiPropertyOptional({ example: 'Furniture', description: 'Top-level category.' })
  @IsOptional()
  @IsString()
  categoryL1?: string;

  @ApiPropertyOptional({ example: 'Storage', description: 'Second-level category.' })
  @IsOptional()
  @IsString()
  categoryL2?: string;

  @ApiPropertyOptional({ example: 'Sideboards', description: 'Third-level category.' })
  @IsOptional()
  @IsString()
  categoryL3?: string;

  @ApiPropertyOptional({ example: 'good', description: 'Condition grade.' })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({ example: '1960s', description: 'Era or period of the piece.' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: 'Denmark', description: 'Country or region of origin.' })
  @IsOptional()
  @IsString()
  origin?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['teak', 'brass'],
    maxItems: 20,
    description: 'Materials, used by the multi-enum search filters. Up to 20 entries.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  materials?: string[];

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    description:
      'Units available. Defaults to 0 — set it before publishing or the listing is unbuyable.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}

/** Body for PATCH /listings/{id}. Every field is optional; omitted fields are left untouched. */
export class UpdateListingDto extends CreateListingDto {
  @ApiPropertyOptional({
    example: 'Mid-century teak sideboard (restored)',
    maxLength: 200,
    description: 'New title. Optional here, unlike on create.',
  })
  @IsOptional()
  @IsString()
  declare title: string;
}

/** Body for PATCH /listings/{id}/stock — a compare-and-set stock write. */
export class UpdateStockDto {
  @ApiProperty({
    example: 3,
    minimum: 0,
    description: 'New absolute quantity (not a delta). Setting 0 auto-closes the listing.',
  })
  @IsInt()
  @Min(0)
  stockQuantity!: number;

  /**
   * The stockVersion the client last saw. The update only applies if it still matches (optimistic
   * lock / compare-and-set) — concurrent buyers can't both decrement the last unit. Omit to force.
   */
  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
    description:
      'The `stockVersion` you last read. The write only lands if it still matches (optimistic lock); a mismatch returns 409. Omit to force the write.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
