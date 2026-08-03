import { Module } from '@nestjs/common';
import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { FollowController } from './follow.controller';
import { FollowService } from './follow.service';
import { HighlightController } from './highlight.controller';
import { HighlightService } from './highlight.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { UserSocialController } from './user-social.controller';

/**
 * Social graph & engagement (follows, favorites/wishlist, stories, highlights).
 *
 * UserSocialController hosts the public, unauthenticated `/users/:id/...` reads; the other controllers
 * host the authed write surfaces. All denormalized counters (User.followers/followingCount,
 * Story.likeCount) are maintained inside the same transaction as the edge they describe, so they can
 * never drift, and every toggle is idempotent.
 */
@Module({
  controllers: [
    FollowController,
    FavoriteController,
    StoryController,
    HighlightController,
    UserSocialController,
  ],
  providers: [FollowService, FavoriteService, StoryService, HighlightService],
})
export class SocialModule {}
