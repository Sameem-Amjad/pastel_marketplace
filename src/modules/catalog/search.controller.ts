import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/pagination/cursor.util';
import { SearchListingsDto } from './dto/search.dto';
import { SearchHit, SearchService } from './search.service';

/**
 * Public search surface (doc 05). Registered BEFORE CatalogController so `/listings/suggest` resolves
 * as a literal before the `/listings/:id` detail route. No @Scopes → public-read.
 */
@ApiTags('search')
@Controller('listings')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  list(@Query() query: SearchListingsDto): Promise<Page<SearchHit>> {
    return this.search.queryListings(query);
  }

  @Get('suggest')
  suggest(@Query('q') q: string): Promise<string[]> {
    return this.search.suggest(q ?? '');
  }
}
