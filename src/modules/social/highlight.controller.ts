import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { AddHighlightStoryDto, CreateHighlightDto } from './dto/highlight.dto';
import { HighlightService } from './highlight.service';
import { HighlightResource, toHighlightResource } from './social.mapper';

@ApiTags('social')
@Controller('highlights')
export class HighlightController {
  constructor(private readonly highlights: HighlightService) {}

  @Post()
  @ApiBearerAuth()
  @Scopes('user')
  async create(
    @CurrentUser() me: Principal,
    @Body() dto: CreateHighlightDto,
  ): Promise<HighlightResource> {
    return toHighlightResource(await this.highlights.create(me.userId!, dto));
  }

  @Post(':id/stories')
  @ApiBearerAuth()
  @Scopes('user')
  async addStory(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddHighlightStoryDto,
  ): Promise<{ ok: true }> {
    await this.highlights.addStory(id, me.userId!, dto);
    return { ok: true };
  }
}
