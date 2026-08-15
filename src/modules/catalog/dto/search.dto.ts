import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const csv = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value as string[];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Search/filter params for GET /listings (doc 05). Mirrors Sharetribe's extended-data query surface:
 * full-text, category, price range, multi-enum materials (has_all/has_any), in-stock, sort.
 *
 * Inherits `perPage` and `cursor` from PaginationQueryDto — this endpoint is keyset-paginated.
 */
export class SearchListingsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'teak sideboard',
    description: 'Full-text query across title and description.',
  })
  @IsOptional()
  @IsString()
  keywords?: string;

  @ApiPropertyOptional({ example: 'Furniture', description: 'Exact top-level category.' })
  @IsOptional()
  @IsString()
  categoryL1?: string;

  @ApiPropertyOptional({ example: 'Storage', description: 'Exact second-level category.' })
  @IsOptional()
  @IsString()
  categoryL2?: string;

  @ApiPropertyOptional({ example: 'Sideboards', description: 'Exact third-level category.' })
  @IsOptional()
  @IsString()
  categoryL3?: string;

  @ApiPropertyOptional({ example: 'product', description: 'Listing type alias.' })
  @IsOptional()
  @IsString()
  listingType?: string;

  @ApiPropertyOptional({ example: 'good', description: 'Condition grade.' })
  @IsOptional()
  @IsString()
  condition?: string;

  /** Price range in minor units. NOTE upper bound is treated INCLUSIVE (doc 05: price < max+1). */
  @ApiPropertyOptional({
    example: 10000,
    minimum: 0,
    description: 'Minimum price in minor units (cents), inclusive.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({
    example: 50000,
    minimum: 0,
    description: 'Maximum price in minor units (cents), **inclusive**.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMax?: number;

  /** Multi-enum: ALL listed materials must be present. */
  @ApiPropertyOptional({
    example: 'teak,brass',
    description: 'Comma-separated materials — a listing must have **all** of them.',
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  materialsAll?: string[];

  /** Multi-enum: ANY of these materials. */
  @ApiPropertyOptional({
    example: 'teak,oak',
    description: 'Comma-separated materials — a listing must have **any** of them.',
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsString({ each: true })
  materialsAny?: string[];

  /**
   * Tri-state stock filter (doc 05): 'in' keeps only in_stock; 'any' (default) keeps everything.
   * The projection already resolves infinite-stock listings to in_stock=true, so 'in' never wrongly
   * drops them.
   */
  @ApiPropertyOptional({
    enum: ['in', 'any'],
    example: 'in',
    description: '`in` keeps only in-stock listings; `any` (default) keeps everything.',
  })
  @IsOptional()
  @IsIn(['in', 'any'])
  stock?: 'in' | 'any';

  @ApiPropertyOptional({
    enum: ['-createdAt', 'createdAt', 'price', '-price', 'relevance', 'popularity'],
    example: '-createdAt',
    description:
      'Sort order; `-` prefix means descending. `relevance` requires `keywords`, otherwise 400.',
  })
  @IsOptional()
  @IsIn(['-createdAt', 'createdAt', 'price', '-price', 'relevance', 'popularity'])
  sort?: string;
}
