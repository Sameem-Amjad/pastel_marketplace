import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
import { AddHighlightStoryDto, CreateHighlightDto } from '../dto/highlight.dto';
import { HighlightService } from '../services/highlight.service';
import { SocialResponseMessage } from '../response/response-message';
import { HighlightResource, toHighlightResource } from '../mappers/social.mapper';

@ApiTags('social')
@Controller('highlights')
export class HighlightController {
  constructor(private readonly highlights: HighlightService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/highlights
   *
   * Description:
   * Creates a named highlight on the caller's profile.
   *
   * Used By:
   * React Native Profile → New highlight.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: HighlightResource, meta } }
   * ------------------------------------------------------------
   */
  @Post()
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.HIGHLIGHT_CREATED)
  @ApiOperation({
    summary: 'Create highlight',
    description: `
Creates an empty highlight owned by the caller; add stories to it with
\`POST /highlights/{id}/stories\`.

A highlight is the permanent counterpart to a story: stories pinned into one stay visible on the
profile after they would otherwise expire.
`,
  })
  @ApiBody({ type: CreateHighlightDto, description: 'Highlight name and optional cover story.' })
  @ApiSuccessEnvelope({
    status: HttpStatus.CREATED,
    description: 'Highlight created (empty).',
    message: SocialResponseMessage.success.HIGHLIGHT_CREATED,
    type: HighlightResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async create(
    @CurrentUser() me: Principal,
    @Body() dto: CreateHighlightDto,
  ): Promise<HighlightResource> {
    return toHighlightResource(await this.highlights.create(me.userId!, dto));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/highlights/{id}/stories
   *
   * Description:
   * Pins an existing story into a highlight.
   *
   * Used By:
   * React Native Profile → Edit highlight.
   *
   * Authentication:
   * Bearer token, `user` scope. Highlight owner only.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/stories')
  @HttpCode(HttpStatus.OK) // adds a membership row to an existing highlight
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.HIGHLIGHT_STORY_ADDED)
  @ApiOperation({
    summary: 'Add story to highlight',
    description: `
Adds a story to the highlight at the given \`position\`.

**Business rules**
- Highlight owner only — someone else's highlight returns \`403\`, a missing one \`404\`.
- \`position\` orders the stories within the highlight, lowest first; it defaults to 0.
- Pinning a story keeps it visible after its \`expiresAt\` has passed.
`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Highlight id.',
  })
  @ApiBody({ type: AddHighlightStoryDto, description: 'The story to pin, and where.' })
  @ApiSuccessEnvelope({
    description: 'Story added to the highlight.',
    message: SocialResponseMessage.success.HIGHLIGHT_STORY_ADDED,
    type: OkResultDto,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(SocialResponseMessage.fail.HIGHLIGHT_NOT_FOUND)
  async addStory(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddHighlightStoryDto,
  ): Promise<{ ok: true }> {
    await this.highlights.addStory(id, me.userId!, dto);
    return { ok: true };
  }
}
