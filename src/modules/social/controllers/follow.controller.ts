import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { OkResultDto } from '../../../common/dto/api-response.dto';
import {
  ApiAuthErrorResponses,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { FollowService } from '../services/follow.service';
import { SocialResponseMessage } from '../response/response-message';

/** Target user path param, shared by both routes. */
const USER_PARAM = {
  name: 'userId',
  format: 'uuid',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  description: 'The user being followed or unfollowed.',
} as const;

@ApiTags('social')
@Controller('follow')
export class FollowController {
  constructor(private readonly follows: FollowService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/follow/{userId}
   *
   * Description:
   * Follows another user.
   *
   * Used By:
   * React Native Profile screen and seller cards.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Post(':userId')
  @HttpCode(HttpStatus.OK) // idempotent relationship write, not a resource creation
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.USER_FOLLOWED)
  @ApiOperation({
    summary: 'Follow user',
    description: `
Creates a follow edge from the caller to \`userId\` and updates both users' counters.

**Business rules**
- **Idempotent** — following someone you already follow succeeds without creating a duplicate, so the
  client can fire this optimistically without tracking current state.
- Following yourself returns \`400\`.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiSuccessEnvelope({
    description: 'Now following the user.',
    message: SocialResponseMessage.success.USER_FOLLOWED,
    type: OkResultDto,
  })
  @ApiValidationErrorResponse("The id is not a UUID, or it is the caller's own id.")
  @ApiAuthErrorResponses()
  async follow(
    @CurrentUser() me: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ ok: true }> {
    return this.follows.follow(me.userId!, userId);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * DELETE /api/v1/follow/{userId}
   *
   * Description:
   * Unfollows a user.
   *
   * Used By:
   * React Native Profile screen and seller cards.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Delete(':userId')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.USER_UNFOLLOWED)
  @ApiOperation({
    summary: 'Unfollow user',
    description: `
Removes the follow edge and updates both counters.

**Idempotent** — unfollowing someone you do not follow still returns \`200\`.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiSuccessEnvelope({
    description: 'No longer following the user.',
    message: SocialResponseMessage.success.USER_UNFOLLOWED,
    type: OkResultDto,
  })
  @ApiAuthErrorResponses()
  async unfollow(
    @CurrentUser() me: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ ok: true }> {
    return this.follows.unfollow(me.userId!, userId);
  }
}
