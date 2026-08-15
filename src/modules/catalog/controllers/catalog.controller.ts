import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiAuthErrorResponses,
  ApiConflictErrorResponse,
  ApiNotFoundErrorResponse,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { RequirePermission } from '../../identity/guards/permissions.guard';
import { CreateListingDto, UpdateListingDto, UpdateStockDto } from '../dto/listing.dto';
import { ListingService } from '../services/listing.service';
import { CatalogResponseMessage } from '../response/response-message';
import { toListingResource, ListingResource } from '../mappers/listing.mapper';

/** Listing id path param, shared by every `/listings/{id}` route below. */
const ID_PARAM = {
  name: 'id',
  format: 'uuid',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  description: 'Listing id.',
} as const;

@ApiTags('catalog')
@Controller('listings')
export class CatalogController {
  constructor(private readonly listings: ListingService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/listings
   *
   * Description:
   * Creates a listing in `draft`.
   *
   * Used By:
   * React Native Sell flow (step 1).
   *
   * Authentication:
   * Bearer token, `user` scope, `postListings` permission.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Post()
  @ApiBearerAuth()
  @Scopes('user')
  @RequirePermission('postListings')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_CREATED)
  @ApiOperation({
    summary: 'Create listing',
    description: `
Creates a listing owned by the caller.

**Business rules**
- The listing starts in \`draft\` and is **not** publicly visible; call
  \`POST /listings/{id}/publish\` when the seller is ready.
- \`priceAmount\` is in minor units (cents) — send \`24999\`, not \`249.99\`.
- \`stockQuantity\` defaults to 0, which makes the listing unbuyable; set it before publishing.
- The caller needs the \`postListings\` permission — restricted accounts get \`403\`.

Used by the React Native Sell flow.
`,
  })
  @ApiBody({ type: CreateListingDto, description: 'Listing creation payload.' })
  @ApiSuccessEnvelope({
    status: HttpStatus.CREATED,
    description: 'Listing created in `draft`.',
    message: CatalogResponseMessage.success.LISTING_CREATED,
    type: ListingResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async create(
    @CurrentUser() me: Principal,
    @Body() dto: CreateListingDto,
  ): Promise<ListingResource> {
    return toListingResource(await this.listings.create(me.userId!, dto));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/listings/mine
   *
   * Description:
   * The caller's own listings, in any state.
   *
   * Used By:
   * React Native Seller dashboard.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: ListingResource[], meta } }
   * ------------------------------------------------------------
   */
  @Get('mine')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.LISTINGS_FETCHED)
  @ApiOperation({
    summary: 'My listings',
    description: `
Returns the caller's own listings — including \`draft\` and \`closed\` ones the public search hides.

Capped at the 50 most recent listings and **not** paginated; the seller dashboard shows a recent
window rather than a full archive.
`,
  })
  @ApiSuccessEnvelope({
    description: "The caller's 50 most recent listings, newest first.",
    message: CatalogResponseMessage.success.LISTINGS_FETCHED,
    type: ListingResource,
    isArray: true,
  })
  @ApiAuthErrorResponses()
  async mine(@CurrentUser() me: Principal): Promise<ListingResource[]> {
    return (await this.listings.listOwn(me.userId!)).map(toListingResource);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/listings/{id}
   *
   * Description:
   * Public detail read of a single listing.
   *
   * Used By:
   * React Native Product-detail screen.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Get(':id')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_FETCHED)
  @ApiOperation({
    summary: 'Get listing',
    description: `
Returns one listing by id. Served from the read replica.

**Business rules**
- Soft-deleted listings are invisible and return \`404\`.
- \`privateData\` and \`metadata\` never leave the server.
- No authentication required — this is the deep-link target for shared listings.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing fetched.',
    message: CatalogResponseMessage.success.LISTING_FETCHED,
    type: ListingResource,
  })
  @ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ListingResource> {
    return toListingResource(await this.listings.getPublic(id));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * PATCH /api/v1/listings/{id}
   *
   * Description:
   * Partially updates a listing the caller owns.
   *
   * Used By:
   * React Native Edit-listing screen.
   *
   * Authentication:
   * Bearer token, `user` scope. Owner only.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Patch(':id')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_UPDATED)
  @ApiOperation({
    summary: 'Update listing',
    description: `
Updates the editable fields of a listing.

**Business rules**
- Owner only — another user's listing returns \`403\`, a missing one \`404\`.
- Every field is optional; omitted fields are left untouched.
- Stock is **not** editable here: use \`PATCH /listings/{id}/stock\`, which is a compare-and-set write.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiBody({ type: UpdateListingDto, description: 'Fields to change. Send only what changed.' })
  @ApiSuccessEnvelope({
    description: 'Listing updated.',
    message: CatalogResponseMessage.success.LISTING_UPDATED,
    type: ListingResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
  async update(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ): Promise<ListingResource> {
    return toListingResource(await this.listings.update(id, me.userId!, dto));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/listings/{id}/publish
   *
   * Description:
   * Moves a listing to `published` and indexes it for search.
   *
   * Used By:
   * React Native Sell flow (final step).
   *
   * Authentication:
   * Bearer token, `user` scope. Owner only.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK) // state transition, not a creation
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_PUBLISHED)
  @ApiOperation({
    summary: 'Publish listing',
    description: `
Publishes a draft or reopens a closed listing, stamps \`publishedAt\`, and makes it searchable.

Search indexing happens transactionally: the search projection is maintained by a database trigger and
an outbox event is emitted for downstream consumers, so the listing appears in \`GET /listings\`
immediately after this returns.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing published and searchable.',
    message: CatalogResponseMessage.success.LISTING_PUBLISHED,
    type: ListingResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
  async publish(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingResource> {
    return toListingResource(await this.listings.publish(id, me.userId!));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/listings/{id}/close
   *
   * Description:
   * Removes a listing from sale without deleting it.
   *
   * Used By:
   * React Native Seller dashboard.
   *
   * Authentication:
   * Bearer token, `user` scope. Owner only.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_CLOSED)
  @ApiOperation({
    summary: 'Close listing',
    description: `
Closes a listing: it drops out of search and can no longer be bought, but the record and its order
history survive. Reversible via \`POST /listings/{id}/reopen\`.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing closed and removed from search.',
    message: CatalogResponseMessage.success.LISTING_CLOSED,
    type: ListingResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
  async close(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingResource> {
    return toListingResource(await this.listings.close(id, me.userId!));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/listings/{id}/reopen
   *
   * Description:
   * Returns a closed listing to `published`.
   *
   * Used By:
   * React Native Seller dashboard.
   *
   * Authentication:
   * Bearer token, `user` scope. Owner only.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_REOPENED)
  @ApiOperation({
    summary: 'Reopen listing',
    description: `
Returns a closed listing to \`published\` and re-stamps \`publishedAt\`, so it re-enters search.

Check \`stockQuantity\` first — reopening a zero-stock listing makes it visible but unbuyable.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing reopened and searchable again.',
    message: CatalogResponseMessage.success.LISTING_REOPENED,
    type: ListingResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
  async reopen(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingResource> {
    return toListingResource(await this.listings.reopen(id, me.userId!));
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * PATCH /api/v1/listings/{id}/stock
   *
   * Description:
   * Compare-and-set stock write (optimistic locking).
   *
   * Used By:
   * React Native Seller dashboard → inventory.
   *
   * Authentication:
   * Bearer token, `user` scope. Owner only.
   *
   * Response:
   * { status, message, data: { value: ListingResource, meta } }
   * ------------------------------------------------------------
   */
  @Patch(':id/stock')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.STOCK_UPDATED)
  @ApiOperation({
    summary: 'Set stock',
    description: `
Sets the absolute stock quantity under an optimistic lock.

**Business rules**
- \`stockQuantity\` is an absolute value, not a delta.
- Send the \`stockVersion\` you last read as \`expectedVersion\`. If stock changed meanwhile the write
  is rejected with \`409\` — re-read the listing and retry. Omit \`expectedVersion\` to force the write.
- Setting stock to 0 auto-closes the listing.
- Every successful write increments \`stockVersion\`.

This is what stops two concurrent buyers from both claiming the last unit.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiBody({ type: UpdateStockDto, description: 'New quantity plus the version being replaced.' })
  @ApiSuccessEnvelope({
    description: 'Stock updated; `stockVersion` has been incremented.',
    message: CatalogResponseMessage.success.STOCK_UPDATED,
    type: ListingResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiConflictErrorResponse(
    CatalogResponseMessage.fail.STOCK_VERSION_CONFLICT,
    'Stock changed since you read it. Re-fetch the listing and retry with the new `stockVersion`.',
  )
  async setStock(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
  ): Promise<ListingResource> {
    return toListingResource(
      await this.listings.setStock(id, me.userId!, dto.stockQuantity, dto.expectedVersion),
    );
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * DELETE /api/v1/listings/{id}
   *
   * Description:
   * Soft-deletes a listing the caller owns.
   *
   * Used By:
   * React Native Seller dashboard.
   *
   * Authentication:
   * Bearer token, `user` scope. Owner only.
   *
   * Response:
   * { status, message, data: { value: null, meta } }
   * ------------------------------------------------------------
   */
  @Delete(':id')
  @ApiBearerAuth()
  @Scopes('user')
  @ResponseMessage(CatalogResponseMessage.success.LISTING_DELETED)
  @ApiOperation({
    summary: 'Delete listing',
    description: `
Soft-deletes the listing: it is closed, stamped \`deletedAt\`, and evicted from search.

The row is retained so existing orders keep referring to a real listing — which is why this is a soft
delete. Subsequent reads of the id return \`404\`.
`,
  })
  @ApiParam(ID_PARAM)
  @ApiSuccessEnvelope({
    description: 'Listing deleted.',
    message: CatalogResponseMessage.success.LISTING_DELETED,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
  async remove(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.listings.softDelete(id, me.userId!);
    return null;
  }
}
