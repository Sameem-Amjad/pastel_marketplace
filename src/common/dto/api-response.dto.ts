import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only models for the response envelope.
 *
 * These exist so `/docs` renders the real wire shape rather than the bare resource: the decorators in
 * `common/swagger` reference them when composing per-endpoint schemas. They are never instantiated.
 */

export class FieldErrorDto {
  @ApiProperty({
    example: 'email',
    description: 'Dot-path of the offending field in the request body (e.g. `address.city`).',
  })
  field!: string;

  @ApiProperty({
    example: 'email must be an email',
    description: 'Human-readable reason, safe to render next to the input.',
  })
  message!: string;
}

/** Pagination block returned in `data.meta` for list endpoints. */
export class PaginationMetaDto {
  @ApiPropertyOptional({ example: 24, description: 'Page size requested (cursor pagination).' })
  perPage?: number;

  @ApiPropertyOptional({ example: 24, description: 'Number of items in this page.' })
  count?: number;

  @ApiPropertyOptional({
    example: 'eyJ2IjoiMjAyNi0wOC0xNFQxMDowMDowMFoiLCJpZCI6IjNmYS4uLiJ9',
    nullable: true,
    description: 'Opaque keyset token — send it back as `?cursor=` to fetch the next page.',
  })
  nextCursor?: string | null;

  @ApiPropertyOptional({ example: 1, description: 'Current page number (offset pagination).' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'Page size (offset pagination).' })
  limit?: number;

  @ApiPropertyOptional({ example: 100, description: 'Total matching rows (offset pagination).' })
  total?: number;

  @ApiPropertyOptional({ example: 5, description: 'Total pages available (offset pagination).' })
  totalPages?: number;

  @ApiProperty({ example: true, description: 'Whether a further page exists.' })
  hasNext!: boolean;

  @ApiProperty({ example: false, description: 'Whether a previous page exists.' })
  hasPrevious!: boolean;
}

/** Debug context attached to `errors.meta` on every failure. */
export class ErrorMetaDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: '/api/v1/users' })
  path!: string;

  @ApiProperty({ example: 'POST' })
  method!: string;

  @ApiProperty({ example: '2026-08-14T10:00:00.000Z' })
  timestamp!: string;
}

/** The failure envelope, identical for every 4xx/5xx the API can return. */
export class ApiErrorResponseDto {
  @ApiProperty({ example: false, description: 'Always `false` on failure.' })
  status!: false;

  @ApiProperty({ example: 'Validation failed.' })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    properties: {
      value: { type: 'array', items: { $ref: '#/components/schemas/FieldErrorDto' } },
      meta: { $ref: '#/components/schemas/ErrorMetaDto' },
    },
  })
  errors!: {
    value: FieldErrorDto[];
    meta: ErrorMetaDto;
  };
}

/** Payload of endpoints whose only job is to succeed (follow, favourite, revoke token, ...). */
export class OkResultDto {
  @ApiProperty({
    example: true,
    description: 'Present so the payload is a JSON object, not `null`.',
  })
  ok!: true;
}

/** Payload of `GET /notifications/unread-count`. */
export class CountResultDto {
  @ApiProperty({ example: 3 })
  count!: number;
}

/** Payload of `POST /notifications/mark-read`. */
export class UpdatedCountResultDto {
  @ApiProperty({ example: 5, description: 'How many rows the write actually changed.' })
  updated!: number;
}
