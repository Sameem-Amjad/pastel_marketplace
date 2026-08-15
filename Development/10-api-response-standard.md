# API Response Standard

**The wire contract every endpoint speaks.** This supersedes the RFC-7807 `problem+json` error format
sketched in doc 06 §5: the React Native (Expo) client parses **one** response shape, not two.

| | |
|---|---|
| **Status** | Implemented |
| **Applies to** | Every route under `/api/v1`. The `/healthz` and `/readyz` probes are the only exceptions. |
| **Enforced by** | `ResponseInterceptor` (successes) + `HttpExceptionFilter` (failures) — both global, so a handler cannot emit an unwrapped body by accident. |

---

## 1. The envelope

### Success

```json
{
  "status": true,
  "message": "User fetched successfully.",
  "data": {
    "value": {},
    "meta": {}
  }
}
```

### Failure

```json
{
  "status": false,
  "message": "Validation failed.",
  "errors": {
    "value": [{ "field": "email", "message": "Email is required" }],
    "meta": {
      "statusCode": 400,
      "path": "/api/v1/auth/signup",
      "method": "POST",
      "timestamp": "2026-08-14T10:00:00.000Z"
    }
  }
}
```

The client branches on `status`, reads the payload at `data.value`, and reads field errors at
`errors.value`. `meta` is always present — `{}` when there is nothing to say.

`errors.value` is `[{ field, message }]` for validation failures and `[]` otherwise. The `field` is the
dot-path into the request body (`address.city`), so a form can bind each message to its input without
string-matching prose.

---

## 2. Where the pieces live

```
src/common/
├── constants/response-message.ts          framework-level messages (validation, auth, 429, 500)
├── decorators/
│   ├── response-message.decorator.ts      @ResponseMessage — sets the success `message`
│   └── skip-response-wrapper.decorator.ts @SkipResponseWrapper — opt out (probes, webhooks)
├── dto/api-response.dto.ts                Swagger models for the envelope
├── filters/http-exception.filter.ts       every failure → the error envelope
├── interceptors/response.interceptor.ts   every success → the success envelope
├── interfaces/api-response.interface.ts   ApiSuccessResponse / ApiErrorResponse
├── pagination/pagination.util.ts          buildCursorMeta / buildOffsetMeta / toSkipTake
├── swagger/api-envelope.decorator.ts      @ApiSuccessEnvelope, @ApiPaginatedEnvelope, error decorators
└── utils/
    ├── response.util.ts                   ResponseUtil.success / error / cursorPaginated
    └── validation-exception.factory.ts    ValidationError[] → [{ field, message }]
```

Domain messages live per module in `src/modules/<module>/response/response-message.ts`.

---

## 3. Writing an endpoint

Return the resource. The interceptor wraps it.

```ts
@Get(':id')
@ResponseMessage(CatalogResponseMessage.success.LISTING_FETCHED)
@ApiOperation({ summary: 'Get listing', description: '...' })
@ApiSuccessEnvelope({
  description: 'Listing fetched.',
  message: CatalogResponseMessage.success.LISTING_FETCHED,
  type: ListingResource,
})
@ApiNotFoundErrorResponse(CatalogResponseMessage.fail.LISTING_NOT_FOUND)
async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ListingResource> {
  return toListingResource(await this.listings.getPublic(id));
}
```

Rules:

1. **Never build an envelope by hand in a controller.** Return the payload; the interceptor wraps it.
   Reach for `ResponseUtil.success(...)` only when you need custom `meta` — the interceptor passes an
   already-formed envelope through untouched.
2. **Never write a message literal.** Every string comes from a `response-message.ts` constant, so copy
   changes and translation have one home per domain.
3. **Throw, don't return, on failure.** `throw new NotFoundException(Msg.fail.LISTING_NOT_FOUND)` — the
   filter turns it into the error envelope. Prisma `P2002`/`P2025`/`P2003` are mapped automatically to
   409/404/422, so services can let them bubble.
4. **Return `null` for empty payloads** (deletes, logouts) so `data.value` is `null` rather than absent.

### Message resolution

`@ResponseMessage` on the handler wins, then the same decorator on the controller class, then
`CommonResponseMessage.success.REQUEST_SUCCEEDED`.

---

## 4. Pagination

Return a `Page<T>` from `common/pagination/cursor.util` and the interceptor produces the meta block —
`perPage` and `hasPrevious` are derived from the request's own query string.

```json
"meta": { "perPage": 24, "count": 24, "nextCursor": "eyJ2Ijoi...", "hasNext": true, "hasPrevious": false }
```

**Cursor, not page numbers.** OFFSET scans and discards every skipped row, so deep pages degrade
linearly — unacceptable for feeds at millions of listings (doc 05). Consequences the client must accept:
there is no page number, no exact total, and pages must be requested in order.

For the bounded admin tables where an operator picks "page 7" and expects a total, use
`OffsetPaginationQueryDto` + `toSkipTake()` + `ResponseUtil.offsetPaginated()`; the meta block is then
`{ page, limit, total, totalPages, hasNext, hasPrevious }`. `PaginationMetaDto` documents both.

---

## 5. Swagger

`@ApiSuccessEnvelope` / `@ApiPaginatedEnvelope` document the **envelope**, not the bare resource — a
plain `@ApiOkResponse({ type: UserResource })` would lie about the wire shape. Error decorators:
`@ApiValidationErrorResponse`, `@ApiAuthErrorResponses` (401+403), `@ApiNotFoundErrorResponse`,
`@ApiConflictErrorResponse`, `@ApiTooManyRequestsResponse`.

Resource classes carry `@ApiProperty` on every field; the mappers still return plain object literals
that structurally satisfy them, so there is no second copy of any shape to keep in sync.

Every DTO field carries `@ApiProperty`/`@ApiPropertyOptional` with an `example`, and every operation
carries an `@ApiOperation` description covering purpose, auth, business rules, and pagination behaviour
— enough for an Expo developer to integrate from `/docs` without reading backend code.

`src/common/response-contract.spec.ts` boots the real app and asserts the envelope end to end; the specs
beside the interceptor and filter cover the branches.

---

## 6. Versioning

Every route is served under `/api/v1` (`setGlobalPrefix('api')` + URI versioning, `defaultVersion: '1'`).
A future breaking change ships as `/api/v2` while installed app versions keep working against v1.

The probes are exempt **twice** — `exclude` in `setGlobalPrefix` drops `/api`, and
`@Controller({ version: VERSION_NEUTRAL })` drops `/v1`. Versioning is applied independently of the
prefix, so both are required or the probes move to `/v1/healthz` and every deployed probe config breaks.
