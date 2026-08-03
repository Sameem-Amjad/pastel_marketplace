import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { RegisterPushTokenDto, RevokePushTokenDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('push/token')
@Scopes('user')
export class PushTokenController {
  constructor(private readonly notifications: NotificationService) {}

  /** Register or refresh this device's FCM token. Idempotent on (userId, token). */
  @Post()
  @HttpCode(200)
  async register(
    @CurrentUser() me: Principal,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ ok: true }> {
    await this.notifications.registerPushToken(
      me.userId!,
      dto.token,
      dto.platform,
      dto.appVersion,
      dto.bundleVersion,
    );
    return { ok: true };
  }

  /** Revoke this device's FCM token (logout / rotation). */
  @Delete()
  @HttpCode(200)
  async revoke(
    @CurrentUser() me: Principal,
    @Body() dto: RevokePushTokenDto,
  ): Promise<{ ok: true }> {
    await this.notifications.revokePushToken(me.userId!, dto.token);
    return { ok: true };
  }
}
