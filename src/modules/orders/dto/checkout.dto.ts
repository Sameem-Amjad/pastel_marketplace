import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Min } from 'class-validator';

/** Body for POST /checkout and POST /checkout/speculate. */
export class CheckoutDto {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'The listing being bought. Must be published and in stock.',
  })
  @IsUUID()
  listingId!: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Units to buy. Must be at least 1 and within available stock.',
  })
  @IsInt()
  @Min(1)
  quantity!: number;
}

/** Body for POST /checkout/confirm. */
export class ConfirmCheckoutDto {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'The order returned by POST /checkout, whose payment is now ready to capture.',
  })
  @IsString()
  orderId!: string;
}
