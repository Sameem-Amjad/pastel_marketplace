import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { OkResultDto } from '../../../common/dto/api-response.dto';
import {
  ApiAuthErrorResponses,
  ApiNotFoundErrorResponse,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { CreateStoryDto } from '../dto/story.dto';
import { SocialResponseMessage } from '../response/response-message';
import { StoryService } from '../services/story.service';
import { StoryResource, toStoryResource } from '../mappers/social.mapper';

/** Story id path param, shared by the like/unlike routes. */
const STORY_PARAM = {
  name: 'id',
  format: 'uuid',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  description: 'Story id.',
} as const;

@ApiTags('social')
@Controller('stories')
export class StoryController {
  constructor(private readonly stories: StoryService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/stories
   *
   * Description:
   * Posts a story to the caller's profile.
   *
   * Used By:
   * React Native Story composer.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: StoryResource, meta } }
   * ------------------------------------------------------------
   */
  @Post()
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.STORY_CREATED)
  @ApiOperation({
    summary: 'Create story',
    description: `
Publishes a story owned by the caller.

**Business rules**
- Media is **not** uploaded here — upload it first and pass the resulting URLs. This endpoint accepts
  JSON only, never multipart.
- Stories expire: read \`expiresAt\` on the response rather than assuming a fixed window. Pin a story
  into a highlight to keep it visible past expiry.
- \`showOnProductPage\` only takes effect when \`listingId\` is also set.
`,
  })
  @ApiBody({ type: CreateStoryDto, description: 'Story payload (URLs of pre-uploaded media).' })
  @ApiSuccessEnvelope({
    status: HttpStatus.CREATED,
    description: 'Story published.',
    message: SocialResponseMessage.success.STORY_CREATED,
    type: StoryResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async create(@CurrentUser() me: Principal, @Body() dto: CreateStoryDto): Promise<StoryResource> {
    return toStoryResource(await this.stories.create(me.userId!, dto));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/stories/{id}/like
   *
   * Description:
   * Likes a story.
   *
   * Used By:
   * React Native Story viewer.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/like')
  @HttpCode(HttpStatus.OK) // idempotent toggle write
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.STORY_LIKED)
  @ApiOperation({
    summary: 'Like story',
    description: `
Records the caller's like and increments \`likeCount\`.

**Idempotent** — liking twice does not double-count, so the client can fire this optimistically.
`,
  })
  @ApiParam(STORY_PARAM)
  @ApiSuccessEnvelope({
    description: 'Story liked.',
    message: SocialResponseMessage.success.STORY_LIKED,
    type: OkResultDto,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(SocialResponseMessage.fail.STORY_NOT_FOUND)
  async like(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.stories.like(id, me.userId!);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * DELETE /api/v1/stories/{id}/like
   *
   * Description:
   * Removes the caller's like from a story.
   *
   * Used By:
   * React Native Story viewer.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Delete(':id/like')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.STORY_UNLIKED)
  @ApiOperation({
    summary: 'Unlike story',
    description: `
Removes the caller's like and decrements \`likeCount\`.

**Idempotent** — unliking a story you have not liked still returns \`200\`.
`,
  })
  @ApiParam(STORY_PARAM)
  @ApiSuccessEnvelope({
    description: 'Like removed.',
    message: SocialResponseMessage.success.STORY_UNLIKED,
    type: OkResultDto,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(SocialResponseMessage.fail.STORY_NOT_FOUND)
  async unlike(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.stories.unlike(id, me.userId!);
  }
}
