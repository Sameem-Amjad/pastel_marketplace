import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Min } from 'class-validator';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { RequirePermission } from '../identity/guards/permissions.guard';
import { CheckoutService } from './checkout.service';

class CheckoutDto {
  @IsUUID() listingId!: string;
  @IsInt() @Min(1) quantity!: number;
}
class ConfirmDto {
  @IsString() orderId!: string;
}

@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
@Scopes('user')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** Price preview — no side effects, no order created. */
  @Post('speculate')
  speculate(@Body() dto: CheckoutDto) {
    return this.checkout.speculate(dto);
  }

  @Post()
  @RequirePermission('initiateTx')
  checkoutOrder(@CurrentUser() me: Principal, @Body() dto: CheckoutDto) {
    return this.checkout.checkout(me.userId!, dto);
  }

  @Post('confirm')
  confirm(@CurrentUser() me: Principal, @Body() dto: ConfirmDto) {
    return this.checkout.confirm(me.userId!, dto.orderId);
  }
}
