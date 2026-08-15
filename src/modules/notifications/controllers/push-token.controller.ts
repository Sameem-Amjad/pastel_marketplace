import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiAuthErrorResponses,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { RegisterPushTokenDto, RevokePushTokenDto } from '../dto/notification.dto';
import { NotificationService } from '../services/notification.service';
import { NotificationResponseMessage } from '../response/response-message';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('push/token')
@Scopes('user')
export class PushTokenController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/push/token
   *
   * Description:
   * Registers or refreshes this device's FCM token. Idempotent on (userId, token).
   *
   * Used By:
   * React Native app startup, after the user grants notification permission, and on every
   * Firebase `onTokenRefresh`.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: null, meta } }
   * ------------------------------------------------------------
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(NotificationResponseMessage.success.PUSH_TOKEN_REGISTERED)
  @ApiOperation({
    summary: 'Register push token',
    description: `
Binds an FCM token to the caller so the backend can push to this device.

**Business rules**
- **Idempotent on (userId, token)** — safe to call on every app launch and on every token refresh.
- If the token was previously bound to a different account it is re-bound to the caller, which is what
  keeps notifications from following a signed-out user on a shared device.
- Call \`DELETE /push/token\` on sign-out; a token left registered keeps receiving pushes.
`,
  })
  @ApiBody({ type: RegisterPushTokenDto, description: 'Device token and metadata.' })
  @ApiSuccessEnvelope({
    description: 'Token registered for this device.',
    message: NotificationResponseMessage.success.PUSH_TOKEN_REGISTERED,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async register(@CurrentUser() me: Principal, @Body() dto: RegisterPushTokenDto): Promise<null> {
    await this.notifications.registerPushToken(
      me.userId!,
      dto.token,
      dto.platform,
      dto.appVersion,
      dto.bundleVersion,
    );
    return null;
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * DELETE /api/v1/push/token
   *
   * Description:
   * Revokes this device's FCM token (sign-out / rotation).
   *
   * Used By:
   * React Native sign-out flow — call this BEFORE clearing the access token.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: null, meta } }
   * ------------------------------------------------------------
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(NotificationResponseMessage.success.PUSH_TOKEN_REVOKED)
  @ApiOperation({
    summary: 'Revoke push token',
    description: `
Unbinds the token so this device stops receiving pushes for the caller.

**Idempotent** — revoking an unknown or already-revoked token still returns \`200\`. Call it before
clearing the access token on sign-out, otherwise the request itself will 401.
`,
  })
  @ApiBody({ type: RevokePushTokenDto, description: 'The token to revoke.' })
  @ApiSuccessEnvelope({
    description: 'Token revoked.',
    message: NotificationResponseMessage.success.PUSH_TOKEN_REVOKED,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async revoke(@CurrentUser() me: Principal, @Body() dto: RevokePushTokenDto): Promise<null> {
    await this.notifications.revokePushToken(me.userId!, dto.token);
    return null;
  }
}
