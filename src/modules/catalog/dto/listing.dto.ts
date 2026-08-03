import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateListingDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string;

  /** Price in minor units (cents). Server is authoritative; never trusts a computed total. */
  @IsOptional() @IsInt() @Min(0) priceAmount?: number;
  @IsOptional() @IsString() @MaxLength(3) priceCurrency?: string;

  @IsOptional() @IsString() categoryL1?: string;
  @IsOptional() @IsString() categoryL2?: string;
  @IsOptional() @IsString() categoryL3?: string;

  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsString() period?: string;
  @IsOptional() @IsString() origin?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) materials?: string[];

  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
}

export class UpdateListingDto extends CreateListingDto {
  @IsOptional() @IsString() declare title: string;
}

export class UpdateStockDto {
  @IsInt() @Min(0) stockQuantity!: number;

  /**
   * The stockVersion the client last saw. The update only applies if it still matches (optimistic
   * lock / compare-and-set) — concurrent buyers can't both decrement the last unit. Omit to force.
   */
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
