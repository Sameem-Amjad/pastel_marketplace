import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Page } from '../../common/pagination/cursor.util';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { MarkReadDto, UpdatePreferencesDto } from './dto/notification.dto';
import { NotificationResource, toNotificationResource } from './notification.mapper';
import { NotificationService } from './notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@Scopes('user')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** My notifications, newest-first, keyset-paginated. Future-scheduled rows stay hidden until due. */
  @Get()
  async list(
    @CurrentUser() me: Principal,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<NotificationResource>> {
    const page = await this.notifications.listForUser(me.userId!, q.perPage, q.cursor);
    return {
      items: page.items.map(toNotificationResource),
      nextCursor: page.nextCursor,
    };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() me: Principal): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(me.userId!) };
  }

  @Post('mark-read')
  async markRead(
    @CurrentUser() me: Principal,
    @Body() dto: MarkReadDto,
  ): Promise<{ updated: number }> {
    return { updated: await this.notifications.markRead(me.userId!, dto.ids) };
  }

  @Get('preferences')
  async getPreferences(
    @CurrentUser() me: Principal,
  ): Promise<{ priorities: Prisma.JsonValue; enabled: Prisma.JsonValue }> {
    return this.notifications.getPreferences(me.userId!);
  }

  @Put('preferences')
  async updatePreferences(
    @CurrentUser() me: Principal,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{ priorities: Prisma.JsonValue; enabled: Prisma.JsonValue }> {
    return this.notifications.updatePreferences(me.userId!, dto.priorities, dto.enabled);
  }
}
