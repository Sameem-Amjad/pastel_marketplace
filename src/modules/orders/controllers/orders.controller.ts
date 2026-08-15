import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiAuthErrorResponses,
  ApiConflictErrorResponse,
  ApiNotFoundErrorResponse,
  ApiSuccessEnvelope,
} from '../../../common/swagger/api-envelope.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { Actor } from '../process/process.types';
import { OrderStateMachine } from '../services/order-state-machine.service';
import { OrderResponseMessage } from '../response/response-message';
import { toOrderResource, OrderResource } from '../mappers/order.mapper';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@Scopes('user')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fsm: OrderStateMachine,
  ) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/orders/{id}
   *
   * Description:
   * Order detail, including the price breakdown.
   *
   * Used By:
   * React Native Order-detail screen (both the buyer's Purchases and the seller's Sales tab).
   *
   * Authentication:
   * Bearer token, `user` scope. Buyer or seller on the order only.
   *
   * Response:
   * { status, message, data: { value: OrderResource, meta } }
   * ------------------------------------------------------------
   */
  @Get(':id')
  @ResponseMessage(OrderResponseMessage.success.ORDER_FETCHED)
  @ApiOperation({
    summary: 'Get order',
    description: `
Returns one order with its line items.

**Business rules**
- Only the buyer (\`customerId\`) or the seller (\`providerId\`) may read an order; anyone else gets
  \`403\`.
- Amounts are in minor units (cents).
- \`state\` and \`lastTransition\` tell the client which actions to offer — drive the UI off them rather
  than inferring from other fields.
`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Order id.',
  })
  @ApiSuccessEnvelope({
    description: 'Order fetched, including its line-item breakdown.',
    message: OrderResponseMessage.success.ORDER_FETCHED,
    type: OrderResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(OrderResponseMessage.fail.ORDER_NOT_FOUND)
  async detail(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResource> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { lineItems: true },
    });
    if (!order) throw new NotFoundException(OrderResponseMessage.fail.ORDER_NOT_FOUND);
    this.assertParty(me, order.customerId, order.providerId);
    return toOrderResource(order, order.lineItems);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/orders/{id}/transitions/{name}
   *
   * Description:
   * Invokes a state-machine transition on the order. The actor (customer or provider) is derived
   * from the caller's relationship to the order — it is never taken from the request.
   *
   * Used By:
   * React Native Order-detail screen action buttons (mark shipped, mark received, cancel, ...).
   *
   * Authentication:
   * Bearer token, `user` scope. Buyer or seller on the order only.
   *
   * Response:
   * { status, message, data: { value: OrderResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/transitions/:name')
  @HttpCode(HttpStatus.OK) // advances an existing order; creates nothing
  @ResponseMessage(OrderResponseMessage.success.TRANSITION_APPLIED)
  @ApiOperation({
    summary: 'Apply order transition',
    description: `
Applies a named transition to the order and returns the updated record.

**Business rules**
- The actor is derived server-side from whether the caller is the buyer or the seller; a client cannot
  claim to be the other party.
- The transition must be legal from the order's current state, otherwise \`409\`. Re-sending a
  transition that has already been applied is a \`409\`, not a silent success — read \`state\` back
  before retrying.
- The actor must be permitted to make that particular transition, otherwise \`403\`.
- Money-moving transitions are executed transactionally with their Stripe calls.

Offer only the transitions the current \`state\` allows rather than hard-coding a fixed button set.
`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Order id.',
  })
  @ApiParam({
    name: 'name',
    example: 'mark-delivered',
    description: "Transition name as defined by the order's process.",
  })
  @ApiSuccessEnvelope({
    description: 'Transition applied; the order has advanced.',
    message: OrderResponseMessage.success.TRANSITION_APPLIED,
    type: OrderResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(OrderResponseMessage.fail.ORDER_NOT_FOUND)
  @ApiConflictErrorResponse(
    OrderResponseMessage.fail.INVALID_TRANSITION,
    "The transition is not legal from the order's current state (often: it already ran).",
  )
  async transition(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('name') name: string,
  ): Promise<OrderResource> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(OrderResponseMessage.fail.ORDER_NOT_FOUND);
    const actor = this.actorFor(me, order.customerId, order.providerId);
    const updated = await this.fsm.apply(id, name, actor, { actorUserId: me.userId! });
    return toOrderResource(updated);
  }

  private assertParty(me: Principal, customerId: string, providerId: string): void {
    if (me.userId !== customerId && me.userId !== providerId) {
      throw new ForbiddenException(OrderResponseMessage.fail.NOT_ORDER_PARTY);
    }
  }

  private actorFor(me: Principal, customerId: string, providerId: string): Actor {
    if (me.userId === customerId) return 'customer';
    if (me.userId === providerId) return 'provider';
    throw new ForbiddenException(OrderResponseMessage.fail.NOT_ORDER_PARTY);
  }
}
