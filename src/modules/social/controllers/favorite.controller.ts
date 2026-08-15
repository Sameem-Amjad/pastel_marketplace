import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { OkResultDto } from '../../../common/dto/api-response.dto';
import {
  ApiAuthErrorResponses,
  ApiPaginatedEnvelope,
  ApiSuccessEnvelope,
} from '../../../common/swagger/api-envelope.decorator';
import { Page } from '../../../common/pagination/cursor.util';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { FavoriteService } from '../services/favorite.service';
import { SocialResponseMessage } from '../response/response-message';
import { FavoriteResource } from '../mappers/social.mapper';

/** Listing id path param, shared by the add/remove routes. */
const LISTING_PARAM = {
  name: 'listingId',
  format: 'uuid',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  description: 'Listing being favourited or un-favourited.',
} as const;

@ApiTags('social')
@Controller('favorites')
export class FavoriteController {
  constructor(private readonly favorites: FavoriteService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/favorites
   *
   * Description:
   * The caller's favourited listings, keyset-paginated.
   *
   * Used By:
   * React Native Saved/Wishlist tab.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: FavoriteResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get()
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.FAVORITES_FETCHED)
  @ApiOperation({
    summary: 'My favourites',
    description: `
Returns the caller's favourites, newest first.

**Pagination** — cursor-based: send \`data.meta.nextCursor\` back as \`?cursor=\` and stop when
\`hasNext\` is \`false\`. There are no page numbers.

Each row carries only \`listingId\`; fetch \`GET /listings/{id}\` for the card data, or keep the listing
in a local cache keyed by id.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Favourites page, plus the cursor for the next one.',
    message: SocialResponseMessage.success.FAVORITES_FETCHED,
    type: FavoriteResource,
  })
  @ApiAuthErrorResponses()
  async list(
    @CurrentUser() me: Principal,
    @Query() q: PaginationQueryDto,
  ): Promise<Page<FavoriteResource>> {
    return this.favorites.listMine(me.userId!, q);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/favorites/{listingId}
   *
   * Description:
   * Adds a listing to the caller's favourites.
   *
   * Used By:
   * React Native heart button on listing cards and the product page.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Post(':listingId')
  @HttpCode(HttpStatus.OK) // idempotent toggle write
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.FAVORITE_ADDED)
  @ApiOperation({
    summary: 'Add favourite',
    description: `
Adds the listing to the caller's favourites.

**Idempotent** — favouriting an already-favourited listing succeeds without creating a duplicate, so
the heart button can be fired optimistically.
`,
  })
  @ApiParam(LISTING_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing favourited.',
    message: SocialResponseMessage.success.FAVORITE_ADDED,
    type: OkResultDto,
  })
  @ApiAuthErrorResponses()
  async add(
    @CurrentUser() me: Principal,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<{ ok: true }> {
    return this.favorites.add(me.userId!, listingId);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * DELETE /api/v1/favorites/{listingId}
   *
   * Description:
   * Removes a listing from the caller's favourites.
   *
   * Used By:
   * React Native heart button and the Saved tab.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: { ok: true }, meta } }
   * ------------------------------------------------------------
   */
  @Delete(':listingId')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(SocialResponseMessage.success.FAVORITE_REMOVED)
  @ApiOperation({
    summary: 'Remove favourite',
    description: `
Removes the listing from the caller's favourites.

**Idempotent** — removing a listing that was not favourited still returns \`200\`.
`,
  })
  @ApiParam(LISTING_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing removed from favourites.',
    message: SocialResponseMessage.success.FAVORITE_REMOVED,
    type: OkResultDto,
  })
  @ApiAuthErrorResponses()
  async remove(
    @CurrentUser() me: Principal,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<{ ok: true }> {
    return this.favorites.remove(me.userId!, listingId);
  }
}
