import { Module } from '@nestjs/common';
import { CatalogController } from './controllers/catalog.controller';
import { ListingService } from './services/listing.service';
import { SearchController } from './controllers/search.controller';
import { SearchService } from './services/search.service';

/**
 * Catalog & Search (doc 03 CAT-*, doc 05). SearchController is listed first so its literal routes
 * (/listings, /listings/suggest) register before CatalogController's /listings/:id param route.
 */
@Module({
  controllers: [SearchController, CatalogController],
  providers: [ListingService, SearchService],
  exports: [ListingService],
})
export class CatalogModule {}
