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
 */
export class SearchListingsDto extends PaginationQueryDto {
  @IsOptional() @IsString() keywords?: string;

  @IsOptional() @IsString() categoryL1?: string;
  @IsOptional() @IsString() categoryL2?: string;
  @IsOptional() @IsString() categoryL3?: string;

  @IsOptional() @IsString() listingType?: string;
  @IsOptional() @IsString() condition?: string;

  /** Price range in minor units. NOTE upper bound is treated INCLUSIVE (doc 05: price < max+1). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceMax?: number;

  /** Multi-enum: ALL listed materials must be present. */
  @IsOptional() @Transform(csv) @IsArray() @IsString({ each: true }) materialsAll?: string[];
  /** Multi-enum: ANY of these materials. */
  @IsOptional() @Transform(csv) @IsArray() @IsString({ each: true }) materialsAny?: string[];

  /**
   * Tri-state stock filter (doc 05): 'in' keeps only in_stock; 'any' (default) keeps everything.
   * The projection already resolves infinite-stock listings to in_stock=true, so 'in' never wrongly
   * drops them.
   */
  @IsOptional() @IsIn(['in', 'any']) stock?: 'in' | 'any';

  @IsOptional() @IsIn(['-createdAt', 'createdAt', 'price', '-price', 'relevance', 'popularity'])
  sort?: string;
}
