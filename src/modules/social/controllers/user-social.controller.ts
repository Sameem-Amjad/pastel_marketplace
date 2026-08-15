import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiNotFoundErrorResponse,
  ApiPaginatedEnvelope,
  ApiSuccessEnvelope,
} from '../../../common/swagger/api-envelope.decorator';
import { Page } from '../../../common/pagination/cursor.util';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { FollowService } from '../services/follow.service';
import { HighlightService } from '../services/highlight.service';
import { SocialResponseMessage } from '../response/response-message';
import { StoryService } from '../services/story.service';
import {
  HighlightResource,
  PublicUserResource,
  StoryResource,
  toHighlightResource,
  toStoryResource,
} from '../mappers/social.mapper';

/** Profile-owner path param, shared by every route below. */
const USER_PARAM = {
  name: 'id',
  format: 'uuid',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  description: 'The user whose profile is being read.',
} as const;

/**
 * Public, unauthenticated reads of a user's social surface (no @Scopes). Every projection is
 * public-safe — see social.mapper — so nothing sensitive (email, passwordHash, *Data buckets) leaks.
 */
@ApiTags('social')
@Controller('users')
export class UserSocialController {
  constructor(
    private readonly follows: FollowService,
    private readonly stories: StoryService,
    private readonly highlights: HighlightService,
  ) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/users/{id}/followers
   *
   * Description:
   * Who follows this user, keyset-paginated.
   *
   * Used By:
   * React Native Profile → Followers list.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: PublicUserResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get(':id/followers')
  @ResponseMessage(SocialResponseMessage.success.FOLLOWERS_FETCHED)
  @ApiOperation({
    summary: 'List followers',
    description: `
Returns the users following \`id\`, newest first.

**Pagination** — cursor-based: echo \`data.meta.nextCursor\` as \`?cursor=\`, stop when \`hasNext\` is
\`false\`.

Rows are the minimal public projection (id, displayName, handle, profileImageId) — enough to render a
list row without a second call, and nothing sensitive.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiPaginatedEnvelope({
    description: 'Followers page, plus the cursor for the next one.',
    message: SocialResponseMessage.success.FOLLOWERS_FETCHED,
    type: PublicUserResource,
  })
  async followers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<PublicUserResource>> {
    return this.follows.listFollowers(id, q);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/users/{id}/following
   *
   * Description:
   * Who this user follows, keyset-paginated.
   *
   * Used By:
   * React Native Profile → Following list.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: PublicUserResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get(':id/following')
  @ResponseMessage(SocialResponseMessage.success.FOLLOWING_FETCHED)
  @ApiOperation({
    summary: 'List following',
    description: `
Returns the users that \`id\` follows, newest first. Same cursor pagination and same public projection
as \`GET /users/{id}/followers\`.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiPaginatedEnvelope({
    description: 'Following page, plus the cursor for the next one.',
    message: SocialResponseMessage.success.FOLLOWING_FETCHED,
    type: PublicUserResource,
  })
  async following(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<PublicUserResource>> {
    return this.follows.listFollowing(id, q);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/users/{id}/stories
   *
   * Description:
   * A user's currently-live stories.
   *
   * Used By:
   * React Native Profile header (story ring) and the story viewer.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: StoryResource[], meta } }
   * ------------------------------------------------------------
   */
  @Get(':id/stories')
  @ResponseMessage(SocialResponseMessage.success.STORIES_FETCHED)
  @ApiOperation({
    summary: 'List user stories',
    description: `
Returns the user's currently-visible stories, oldest first so the viewer can play them in order.

Expired stories are already filtered out, so an empty array means "no story ring" — the client does not
need to check \`expiresAt\` itself. Not paginated: a user's live stories are a small, bounded set.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiSuccessEnvelope({
    description: "The user's live stories, in playback order.",
    message: SocialResponseMessage.success.STORIES_FETCHED,
    type: StoryResource,
    isArray: true,
  })
  @ApiNotFoundErrorResponse(SocialResponseMessage.fail.USER_NOT_FOUND)
  async stories_(@Param('id', ParseUUIDPipe) id: string): Promise<StoryResource[]> {
    return (await this.stories.listForUser(id)).map(toStoryResource);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/users/{id}/highlights
   *
   * Description:
   * A user's permanent story highlights.
   *
   * Used By:
   * React Native Profile → highlight bubbles.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: HighlightResource[], meta } }
   * ------------------------------------------------------------
   */
  @Get(':id/highlights')
  @ResponseMessage(SocialResponseMessage.success.HIGHLIGHTS_FETCHED)
  @ApiOperation({
    summary: 'List user highlights',
    description: `
Returns the user's highlights — the permanent collections shown as bubbles on the profile.

Each row carries only the highlight itself (name and cover); the stories inside it are fetched when the
user opens a bubble. Not paginated.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiSuccessEnvelope({
    description: "The user's highlights.",
    message: SocialResponseMessage.success.HIGHLIGHTS_FETCHED,
    type: HighlightResource,
    isArray: true,
  })
  @ApiNotFoundErrorResponse(SocialResponseMessage.fail.USER_NOT_FOUND)
  async highlights_(@Param('id', ParseUUIDPipe) id: string): Promise<HighlightResource[]> {
    return (await this.highlights.listForUser(id)).map(toHighlightResource);
  }
}
