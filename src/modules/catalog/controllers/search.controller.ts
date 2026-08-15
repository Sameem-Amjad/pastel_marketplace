import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiPaginatedEnvelope,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Page } from '../../../common/pagination/cursor.util';
import { SearchListingsDto } from '../dto/search.dto';
import { CatalogResponseMessage } from '../response/response-message';
import { SearchHit, SearchService } from '../services/search.service';

/**
 * Public search surface (doc 05). Registered BEFORE CatalogController so `/listings/suggest` resolves
 * as a literal before the `/listings/:id` detail route. No @Scopes → public-read.
 */
@ApiTags('search')
@Controller('listings')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/listings
   *
   * Description:
   * Filtered, keyset-paginated listing search.
   *
   * Used By:
   * React Native Home feed, Category browse, and Search results.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: SearchHit[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get()
  @ResponseMessage(CatalogResponseMessage.success.SEARCH_COMPLETED)
  @ApiOperation({
    summary: 'Search listings',
    description: `
Searches published listings. Every filter is optional and they combine with AND.

**Pagination — cursor, not page numbers**
Read \`data.meta.nextCursor\` and send it back as \`?cursor=\`; stop when \`data.meta.hasNext\` is
\`false\`. There is no page number and no exact total: keyset paging keeps latency flat no matter how
far the user scrolls, which is what an infinite feed needs. Do **not** try to jump to an arbitrary
page — request pages in order.

**Business rules**
- Only published, non-deleted listings are returned.
- \`priceMin\`/\`priceMax\` are in minor units (cents) and both bounds are **inclusive**.
- \`materialsAll\` requires every listed material; \`materialsAny\` requires at least one.
- \`sort=relevance\` requires \`keywords\`, otherwise \`400\`.
- An unparseable \`cursor\` returns \`400\` — drop it and restart from the first page.
- Served from the read replica, so a just-published listing may take a moment to appear.

Each row is a lightweight card projection; fetch \`GET /listings/{id}\` for full detail.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Matching listings, plus the cursor for the next page.',
    message: CatalogResponseMessage.success.SEARCH_COMPLETED,
    type: SearchHit,
  })
  @ApiValidationErrorResponse('Invalid filter combination, or an unparseable `cursor`.')
  list(@Query() query: SearchListingsDto): Promise<Page<SearchHit>> {
    return this.search.queryListings(query);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/listings/suggest
   *
   * Description:
   * Type-ahead suggestions for the search box.
   *
   * Used By:
   * React Native search bar (debounce ~250 ms before calling).
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: string[], meta } }
   * ------------------------------------------------------------
   */
  @Get('suggest')
  @ResponseMessage(CatalogResponseMessage.success.SUGGESTIONS_FETCHED)
  @ApiOperation({
    summary: 'Search suggestions',
    description: `
Returns type-ahead suggestions for a partial query.

An empty or missing \`q\` yields an empty array rather than an error, so the client can call this
unconditionally as the user types. Debounce on the client — this fires on every keystroke otherwise.
`,
  })
  @ApiQuery({
    name: 'q',
    required: false,
    example: 'teak',
    description: 'Partial query. Empty or missing returns an empty array.',
  })
  @ApiSuccessEnvelope({
    description: 'Suggestions for the partial query.',
    message: CatalogResponseMessage.success.SUGGESTIONS_FETCHED,
    type: { type: 'string', example: 'teak sideboard' },
    isArray: true,
  })
  suggest(@Query('q') q: string): Promise<string[]> {
    return this.search.suggest(q ?? '');
  }
}
