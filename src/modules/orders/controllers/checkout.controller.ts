import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiAuthErrorResponses,
  ApiNotFoundErrorResponse,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { RequirePermission } from '../../identity/guards/permissions.guard';
import { PriceBreakdown } from '../../pricing/entities/pricing.types';
import { CheckoutResult, CheckoutService } from '../services/checkout.service';
import {
  CheckoutResultResource,
  ConfirmResultResource,
  PriceBreakdownResource,
} from '../response/checkout.response';
import { CheckoutDto, ConfirmCheckoutDto } from '../dto/checkout.dto';
import { OrderResponseMessage } from '../response/response-message';

/**
 * The three-step purchase flow (doc 04 §1.1, doc 06):
 *
 *   1. POST /checkout/speculate  → price preview, no side effects
 *   2. POST /checkout            → create the order and a Stripe PaymentIntent
 *   3. POST /checkout/confirm    → capture into platform escrow
 *
 * Every price is computed server-side; the client never sends a total.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
@Scopes('user')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/checkout/speculate
   *
   * Description:
   * Price preview — no order is created and nothing is charged.
   *
   * Used By:
   * React Native Checkout screen, to render the order summary before the buyer commits.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: PriceBreakdownResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('speculate')
  @HttpCode(HttpStatus.OK) // read-only preview; nothing is created
  @ResponseMessage(OrderResponseMessage.success.PRICE_SPECULATED)
  @ApiOperation({
    summary: 'Preview price',
    description: `
Computes the full price breakdown for a prospective purchase **without any side effects** — no order,
no PaymentIntent, no stock movement.

Call this to render the order summary; call \`POST /checkout\` when the buyer confirms. The breakdown
is recomputed server-side at checkout, so a stale preview cannot lock in an old price.

**Business rules**
- All amounts are in minor units (cents).
- \`payinTotalAmount\` is what the buyer pays; \`payoutTotalAmount\` is what the seller receives; the
  difference is the platform commission.
- The listing must exist and carry a price, otherwise \`404\`/\`400\`.
`,
  })
  @ApiBody({ type: CheckoutDto, description: 'What the buyer intends to purchase.' })
  @ApiSuccessEnvelope({
    description: 'Price breakdown computed. Nothing was created or charged.',
    message: OrderResponseMessage.success.PRICE_SPECULATED,
    type: PriceBreakdownResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(OrderResponseMessage.fail.LISTING_UNAVAILABLE)
  speculate(@Body() dto: CheckoutDto): Promise<PriceBreakdown> {
    return this.checkout.speculate(dto);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/checkout
   *
   * Description:
   * Creates the order and preauthorises payment.
   *
   * Used By:
   * React Native Checkout screen, when the buyer taps Pay.
   *
   * Authentication:
   * Bearer token, `user` scope, `initiateTx` permission.
   *
   * Response:
   * { status, message, data: { value: CheckoutResultResource, meta } }
   * ------------------------------------------------------------
   */
  @Post()
  @RequirePermission('initiateTx')
  @ResponseMessage(OrderResponseMessage.success.CHECKOUT_STARTED)
  @ApiOperation({
    summary: 'Start checkout',
    description: `
Creates the order, snapshots the server-computed price on it, and opens a Stripe PaymentIntent.

**Client flow**
1. Call this endpoint.
2. Pass \`data.value.clientSecret\` to the Stripe React Native SDK and let the buyer authorise.
3. Call \`POST /checkout/confirm\` with \`data.value.orderId\` to capture.

**Business rules**
- A seller cannot buy their own listing → \`400\`.
- Quantity must be at least 1 and the listing must be purchasable → \`400\`/\`404\`.
- The price is recomputed here from server data; any total sent by the client is ignored.
- Send an \`Idempotency-Key\` header so a retry after a dropped response cannot double-charge.
`,
  })
  @ApiBody({ type: CheckoutDto, description: 'What the buyer is purchasing.' })
  @ApiSuccessEnvelope({
    status: HttpStatus.CREATED,
    description: 'Order created and payment preauthorised.',
    message: OrderResponseMessage.success.CHECKOUT_STARTED,
    type: CheckoutResultResource,
  })
  @ApiValidationErrorResponse(
    'Invalid payload, or the buyer owns the listing, or the quantity is unavailable.',
  )
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(OrderResponseMessage.fail.LISTING_UNAVAILABLE)
  checkoutOrder(@CurrentUser() me: Principal, @Body() dto: CheckoutDto): Promise<CheckoutResult> {
    return this.checkout.checkout(me.userId!, dto);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/checkout/confirm
   *
   * Description:
   * Captures the preauthorised payment into platform escrow.
   *
   * Used By:
   * React Native Checkout screen, after the Stripe SDK reports success.
   *
   * Authentication:
   * Bearer token, `user` scope. Buyer only.
   *
   * Response:
   * { status, message, data: { value: ConfirmResultResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK) // transitions an existing order; creates nothing
  @ResponseMessage(OrderResponseMessage.success.PAYMENT_CONFIRMED)
  @ApiOperation({
    summary: 'Confirm payment',
    description: `
Applies the \`confirm-payment\` transition: funds move into platform escrow and the order advances.

**Business rules**
- Only the buyer on the order may confirm → \`403\`.
- The order must be in a state that allows \`confirm-payment\`, otherwise \`409\` — an already-confirmed
  order is not re-confirmed.
- Funds stay in escrow until the order completes; the seller payout is a later transition.
`,
  })
  @ApiBody({ type: ConfirmCheckoutDto, description: 'The order to confirm.' })
  @ApiSuccessEnvelope({
    description: 'Payment captured; the order has advanced.',
    message: OrderResponseMessage.success.PAYMENT_CONFIRMED,
    type: ConfirmResultResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(OrderResponseMessage.fail.ORDER_NOT_FOUND)
  confirm(
    @CurrentUser() me: Principal,
    @Body() dto: ConfirmCheckoutDto,
  ): Promise<{ orderId: string; state: string }> {
    return this.checkout.confirm(me.userId!, dto.orderId);
  }
}
