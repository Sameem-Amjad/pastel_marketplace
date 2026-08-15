import { Module } from '@nestjs/common';
import { FavoriteController } from './controllers/favorite.controller';
import { FavoriteService } from './services/favorite.service';
import { FollowController } from './controllers/follow.controller';
import { FollowService } from './services/follow.service';
import { HighlightController } from './controllers/highlight.controller';
import { HighlightService } from './services/highlight.service';
import { StoryController } from './controllers/story.controller';
import { StoryService } from './services/story.service';
import { UserSocialController } from './controllers/user-social.controller';

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
