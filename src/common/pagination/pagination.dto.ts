import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Standard cursor-pagination query params for all list endpoints (doc 05). */
export class PaginationQueryDto {
  /** Page size. Default 24 (Sharetribe parity), hard-capped to protect the DB. */
  @ApiPropertyOptional({
    example: 24,
    default: 24,
    minimum: 1,
    maximum: 100,
    description: 'Page size. Hard-capped at 100 to protect the database.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 24 : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 24;

  /** Opaque keyset cursor from the previous page's `nextCursor`. */
  @ApiPropertyOptional({
    example: 'eyJ2IjoiMjAyNi0wOC0xNFQxMDowMDowMFoiLCJpZCI6IjNmYS4uLiJ9',
    description:
      'Opaque keyset cursor. Echo back `data.meta.nextCursor` from the previous page; omit for the first page.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * Classic page/limit params, for the bounded tables where an operator picks "page 7" and expects an
 * exact total. Feed-style endpoints must keep using {@link PaginationQueryDto}: OFFSET scans and
 * discards every skipped row, so deep pages degrade linearly (doc 05).
 *
 * Pair with `toSkipTake()` and `ResponseUtil.offsetPaginated()` from `common/pagination`.
 */
export class OffsetPaginationQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    description: '1-based page number.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 1 : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Rows per page. Hard-capped at 100.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 20 : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
