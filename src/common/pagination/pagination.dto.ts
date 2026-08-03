import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Standard cursor-pagination query params for all list endpoints (doc 05). */
export class PaginationQueryDto {
  /** Page size. Default 24 (Sharetribe parity), hard-capped to protect the DB. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? 24 : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 24;

  /** Opaque keyset cursor from the previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
