import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/pagination/cursor.util';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { FavoriteService } from './favorite.service';
import { FavoriteResource } from './social.mapper';

@ApiTags('social')
@Controller('favorites')
export class FavoriteController {
  constructor(private readonly favorites: FavoriteService) {}

  @Get()
  @ApiBearerAuth()
  @Scopes('user')
  async list(
    @CurrentUser() me: Principal,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<FavoriteResource>> {
    return this.favorites.listMine(me.userId!, q);
  }

  @Post(':listingId')
  @ApiBearerAuth()
  @Scopes('user')
  async add(
    @CurrentUser() me: Principal,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<{ ok: true }> {
    return this.favorites.add(me.userId!, listingId);
  }

  @Delete(':listingId')
  @ApiBearerAuth()
  @Scopes('user')
  async remove(
    @CurrentUser() me: Principal,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<{ ok: true }> {
    return this.favorites.remove(me.userId!, listingId);
  }
}
