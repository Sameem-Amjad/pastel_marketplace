import { Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { FollowService } from './follow.service';

@ApiTags('social')
@Controller('follow')
export class FollowController {
  constructor(private readonly follows: FollowService) {}

  @Post(':userId')
  @ApiBearerAuth()
  @Scopes('user')
  async follow(
    @CurrentUser() me: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ ok: true }> {
    return this.follows.follow(me.userId!, userId);
  }

  @Delete(':userId')
  @ApiBearerAuth()
  @Scopes('user')
  async unfollow(
    @CurrentUser() me: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ ok: true }> {
    return this.follows.unfollow(me.userId!, userId);
  }
}
