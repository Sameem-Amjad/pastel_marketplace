import { Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { Actor } from './process/process.types';
import { OrderStateMachine } from './order-state-machine.service';
import { toOrderResource, OrderResource } from './order.mapper';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@Scopes('user')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fsm: OrderStateMachine,
  ) {}

  @Get(':id')
  async detail(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<OrderResource> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { lineItems: true } });
    if (!order) throw new NotFoundException('Order not found');
    this.assertParty(me, order.customerId, order.providerId);
    return toOrderResource(order, order.lineItems);
  }

  /** Invoke a transition. The actor is derived from the caller's relationship to the order. */
  @Post(':id/transitions/:name')
  async transition(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('name') name: string,
  ): Promise<OrderResource> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    const actor = this.actorFor(me, order.customerId, order.providerId);
    const updated = await this.fsm.apply(id, name, actor, { actorUserId: me.userId! });
    return toOrderResource(updated);
  }

  private assertParty(me: Principal, customerId: string, providerId: string): void {
    if (me.userId !== customerId && me.userId !== providerId) {
      throw new ForbiddenException('Not a party to this order');
    }
  }

  private actorFor(me: Principal, customerId: string, providerId: string): Actor {
    if (me.userId === customerId) return 'customer';
    if (me.userId === providerId) return 'provider';
    throw new ForbiddenException('Not a party to this order');
  }
}
