import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { CountResultDto, UpdatedCountResultDto } from '../../../common/dto/api-response.dto';
import {
  ApiAuthErrorResponses,
  ApiPaginatedEnvelope,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Page } from '../../../common/pagination/cursor.util';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { MarkReadDto, UpdatePreferencesDto } from '../dto/notification.dto';
import { NotificationResource, toNotificationResource } from '../mappers/notification.mapper';
import { NotificationPreferencesResource } from '../response/notification.response';
import { NotificationService } from '../services/notification.service';
import { NotificationResponseMessage } from '../response/response-message';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@Scopes('user')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/notifications
   *
   * Description:
   * The caller's notification inbox, newest-first and keyset-paginated.
   *
   * Used By:
   * React Native Notifications tab.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: NotificationResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get()
  @ResponseMessage(NotificationResponseMessage.success.NOTIFICATIONS_FETCHED)
  @ApiOperation({
    summary: 'List notifications',
    description: `
Returns the caller's notifications, newest first.

**Pagination** — cursor-based: echo \`data.meta.nextCursor\` as \`?cursor=\`, stop when \`hasNext\` is
\`false\`.

**Business rules**
- Future-scheduled notifications stay hidden until they are due, so the client never has to filter by
  time itself.
- Actor and listing names are denormalised onto the row — a list renders without any follow-up call.
- Rows are recipient-owned: a caller only ever sees their own.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Notification page, plus the cursor for the next one.',
    message: NotificationResponseMessage.success.NOTIFICATIONS_FETCHED,
    type: NotificationResource,
  })
  @ApiAuthErrorResponses()
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

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/notifications/unread-count
   *
   * Description:
   * Number of unread notifications, for the tab badge.
   *
   * Used By:
   * React Native tab bar badge and app-icon badge sync.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { count }, meta } }
   * ------------------------------------------------------------
   */
  @Get('unread-count')
  @ResponseMessage(NotificationResponseMessage.success.UNREAD_COUNT_FETCHED)
  @ApiOperation({
    summary: 'Unread count',
    description: `
Returns how many notifications the caller has not read.

Cheap enough to poll on foreground/resume, but prefer updating the badge from the push payload and
calling this only on app resume.
`,
  })
  @ApiSuccessEnvelope({
    description: 'Current unread count.',
    message: NotificationResponseMessage.success.UNREAD_COUNT_FETCHED,
    type: CountResultDto,
  })
  @ApiAuthErrorResponses()
  async unreadCount(@CurrentUser() me: Principal): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(me.userId!) };
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/notifications/mark-read
   *
   * Description:
   * Marks specific notifications — or all of them — as read.
   *
   * Used By:
   * React Native Notifications tab (on row tap, and on "Mark all read").
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { updated }, meta } }
   * ------------------------------------------------------------
   */
  @Post('mark-read')
  @HttpCode(HttpStatus.OK) // bulk update, not a creation
  @ResponseMessage(NotificationResponseMessage.success.NOTIFICATIONS_MARKED_READ)
  @ApiOperation({
    summary: 'Mark notifications read',
    description: `
Marks notifications as read and returns how many rows actually changed.

**Business rules**
- Send \`ids\` to mark specific rows (max 500), or **omit \`ids\` entirely to mark everything read**.
- Only the caller's own notifications are touched; ids belonging to someone else are silently ignored
  rather than erroring.
- Idempotent: \`updated\` is 0 when the rows were already read.
`,
  })
  @ApiBody({
    type: MarkReadDto,
    description: 'Ids to mark read. Send `{}` (or omit `ids`) to mark all.',
  })
  @ApiSuccessEnvelope({
    description: 'Notifications marked read; `updated` is the number of rows changed.',
    message: NotificationResponseMessage.success.NOTIFICATIONS_MARKED_READ,
    type: UpdatedCountResultDto,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async markRead(
    @CurrentUser() me: Principal,
    @Body() dto: MarkReadDto,
  ): Promise<{ updated: number }> {
    return { updated: await this.notifications.markRead(me.userId!, dto.ids) };
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/notifications/preferences
   *
   * Description:
   * The caller's notification preference maps.
   *
   * Used By:
   * React Native Settings → Notifications.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: NotificationPreferencesResource, meta } }
   * ------------------------------------------------------------
   */
  @Get('preferences')
  @ResponseMessage(NotificationResponseMessage.success.PREFERENCES_FETCHED)
  @ApiOperation({
    summary: 'Get notification preferences',
    description: `
Returns the caller's stored preference maps.

Both maps are client-owned free-form JSON: the server stores and returns them without interpreting the
inner shape, so adding a new notification type needs no backend change. A user who has never saved
preferences gets the stored defaults, never \`null\`.
`,
  })
  @ApiSuccessEnvelope({
    description: 'Stored notification preferences.',
    message: NotificationResponseMessage.success.PREFERENCES_FETCHED,
    type: NotificationPreferencesResource,
  })
  @ApiAuthErrorResponses()
  async getPreferences(
    @CurrentUser() me: Principal,
  ): Promise<{ priorities: Prisma.JsonValue; enabled: Prisma.JsonValue }> {
    return this.notifications.getPreferences(me.userId!);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * PUT /api/v1/notifications/preferences
   *
   * Description:
   * Replaces one or both preference maps.
   *
   * Used By:
   * React Native Settings → Notifications.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: NotificationPreferencesResource, meta } }
   * ------------------------------------------------------------
   */
  @Put('preferences')
  @ResponseMessage(NotificationResponseMessage.success.PREFERENCES_UPDATED)
  @ApiOperation({
    summary: 'Update notification preferences',
    description: `
Stores new preference maps and returns the result.

**Business rules**
- Each map is replaced **wholesale**, not deep-merged — send the complete map you want stored.
- Omitting a key leaves that map untouched, so you can update \`priorities\` without resending
  \`enabled\`.
`,
  })
  @ApiBody({
    type: UpdatePreferencesDto,
    description: 'Maps to replace. Omit one to leave it as-is.',
  })
  @ApiSuccessEnvelope({
    description: 'Preferences updated.',
    message: NotificationResponseMessage.success.PREFERENCES_UPDATED,
    type: NotificationPreferencesResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async updatePreferences(
    @CurrentUser() me: Principal,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{ priorities: Prisma.JsonValue; enabled: Prisma.JsonValue }> {
    return this.notifications.updatePreferences(me.userId!, dto.priorities, dto.enabled);
  }
}
