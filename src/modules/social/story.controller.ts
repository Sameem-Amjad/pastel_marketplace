import { Body, Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { CreateStoryDto } from './dto/story.dto';
import { StoryService } from './story.service';
import { StoryResource, toStoryResource } from './social.mapper';

@ApiTags('social')
@Controller('stories')
export class StoryController {
  constructor(private readonly stories: StoryService) {}

  @Post()
  @ApiBearerAuth()
  @Scopes('user')
  async create(@CurrentUser() me: Principal, @Body() dto: CreateStoryDto): Promise<StoryResource> {
    return toStoryResource(await this.stories.create(me.userId!, dto));
  }

  @Post(':id/like')
  @ApiBearerAuth()
  @Scopes('user')
  async like(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.stories.like(id, me.userId!);
  }

  @Delete(':id/like')
  @ApiBearerAuth()
  @Scopes('user')
  async unlike(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.stories.unlike(id, me.userId!);
  }
}
