import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/pagination/cursor.util';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { FollowService } from './follow.service';
import { HighlightService } from './highlight.service';
import { StoryService } from './story.service';
import {
  HighlightResource,
  PublicUserResource,
  StoryResource,
  toHighlightResource,
  toStoryResource,
} from './social.mapper';

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

  @Get(':id/followers')
  async followers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<PublicUserResource>> {
    return this.follows.listFollowers(id, q);
  }

  @Get(':id/following')
  async following(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<PublicUserResource>> {
    return this.follows.listFollowing(id, q);
  }

  @Get(':id/stories')
  async stories_(@Param('id', ParseUUIDPipe) id: string): Promise<StoryResource[]> {
    return (await this.stories.listForUser(id)).map(toStoryResource);
  }

  @Get(':id/highlights')
  async highlights_(@Param('id', ParseUUIDPipe) id: string): Promise<HighlightResource[]> {
    return (await this.highlights.listForUser(id)).map(toHighlightResource);
  }
}
