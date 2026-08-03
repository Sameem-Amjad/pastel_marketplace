import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { RequirePermission } from '../identity/guards/permissions.guard';
import { CreateListingDto, UpdateListingDto, UpdateStockDto } from './dto/listing.dto';
import { ListingService } from './listing.service';
import { toListingResource, ListingResource } from './listing.mapper';

@ApiTags('catalog')
@Controller('listings')
export class CatalogController {
  constructor(private readonly listings: ListingService) {}

  @Post()
  @ApiBearerAuth()
  @Scopes('user')
  @RequirePermission('postListings')
  async create(@CurrentUser() me: Principal, @Body() dto: CreateListingDto): Promise<ListingResource> {
    return toListingResource(await this.listings.create(me.userId!, dto));
  }

  /** Own listings (seller dashboard). Declared before /:id-style ownership reads is unnecessary here. */
  @Get('mine')
  @ApiBearerAuth()
  @Scopes('user')
  async mine(@CurrentUser() me: Principal): Promise<ListingResource[]> {
    return (await this.listings.listOwn(me.userId!)).map(toListingResource);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ListingResource> {
    return toListingResource(await this.listings.getPublic(id));
  }

  @Patch(':id')
  @ApiBearerAuth()
  @Scopes('user')
  async update(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ): Promise<ListingResource> {
    return toListingResource(await this.listings.update(id, me.userId!, dto));
  }

  @Post(':id/publish')
  @ApiBearerAuth()
  @Scopes('user')
  async publish(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ListingResource> {
    return toListingResource(await this.listings.publish(id, me.userId!));
  }

  @Post(':id/close')
  @ApiBearerAuth()
  @Scopes('user')
  async close(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ListingResource> {
    return toListingResource(await this.listings.close(id, me.userId!));
  }

  @Post(':id/reopen')
  @ApiBearerAuth()
  @Scopes('user')
  async reopen(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ListingResource> {
    return toListingResource(await this.listings.reopen(id, me.userId!));
  }

  @Patch(':id/stock')
  @ApiBearerAuth()
  @Scopes('user')
  async setStock(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
  ): Promise<ListingResource> {
    return toListingResource(
      await this.listings.setStock(id, me.userId!, dto.stockQuantity, dto.expectedVersion),
    );
  }

  @Delete(':id')
  @ApiBearerAuth()
  @Scopes('user')
  async remove(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.listings.softDelete(id, me.userId!);
    return { ok: true };
  }
}
