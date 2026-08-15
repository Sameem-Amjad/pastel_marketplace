import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { CommonResponseMessage } from '../constants/response-message';
import {
  ApiErrorResponseDto,
  ErrorMetaDto,
  FieldErrorDto,
  PaginationMetaDto,
} from '../dto/api-response.dto';

/**
 * Composite Swagger decorators that document the *envelope*, not the bare resource.
 *
 * A plain `@ApiOkResponse({ type: UserResource })` would lie: the client never receives a UserResource
 * at the top level, it receives `{ status, message, data: { value, meta } }`. These helpers compose the
 * real schema so an Expo developer can copy the example straight out of `/docs` and match it against
 * what the app actually parses.
 */

/** Either a class Swagger can introspect, or a hand-written schema for primitives/inline shapes. */
export type EnvelopeValueType = Type<unknown> | SchemaObject;

export interface SuccessEnvelopeOptions {
  /** HTTP status this response documents. Defaults to 200. */
  status?: number;
  /** What this response means, in the endpoint's own terms. */
  description: string;
  /** The exact `message` string the endpoint returns — pass the module's response-message constant. */
  message: string;
  /** Shape of `data.value`. Omit for endpoints whose payload is `null`. */
  type?: EnvelopeValueType;
  /** Wrap `data.value` in an array. */
  isArray?: boolean;
  /** Document `data.meta` as the pagination block instead of a free-form object. */
  paginated?: boolean;
}

function isClass(type: EnvelopeValueType): type is Type<unknown> {
  return typeof type === 'function';
}

function valueSchema(options: SuccessEnvelopeOptions): SchemaObject {
  if (!options.type) return { type: 'object', nullable: true, example: null };

  const base: SchemaObject = isClass(options.type)
    ? ({ $ref: getSchemaPath(options.type) } as SchemaObject)
    : options.type;

  return options.isArray ? { type: 'array', items: base } : base;
}

function metaSchema(options: SuccessEnvelopeOptions): SchemaObject {
  return options.paginated
    ? ({ $ref: getSchemaPath(PaginationMetaDto) } as SchemaObject)
    : { type: 'object', additionalProperties: true, example: {} };
}

/**
 * Documents a success response in the standard envelope.
 *
 *   @ApiSuccessEnvelope({
 *     status: HttpStatus.CREATED,
 *     description: 'Listing created and left in `draft`.',
 *     message: CatalogResponseMessage.success.LISTING_CREATED,
 *     type: ListingResource,
 *   })
 */
export const ApiSuccessEnvelope = (
  options: SuccessEnvelopeOptions,
): MethodDecorator & ClassDecorator => {
  const extraModels: Type<unknown>[] = [];
  if (options.type && isClass(options.type)) extraModels.push(options.type);
  if (options.paginated) extraModels.push(PaginationMetaDto);

  return applyDecorators(
    ...(extraModels.length ? [ApiExtraModels(...extraModels)] : []),
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      schema: {
        type: 'object',
        required: ['status', 'message', 'data'],
        properties: {
          status: { type: 'boolean', enum: [true], example: true },
          message: { type: 'string', example: options.message },
          data: {
            type: 'object',
            required: ['value', 'meta'],
            properties: {
              value: valueSchema(options),
              meta: metaSchema(options),
            },
          },
        },
      },
    }),
  );
};

/** Shorthand for a paginated list: `data.value` is an array, `data.meta` is the pagination block. */
export const ApiPaginatedEnvelope = (
  options: Omit<SuccessEnvelopeOptions, 'isArray' | 'paginated'>,
): MethodDecorator & ClassDecorator =>
  ApiSuccessEnvelope({ ...options, isArray: true, paginated: true });

/** Documents one failure status in the standard error envelope. */
export const ApiErrorEnvelope = (
  status: number,
  description: string,
  message: string,
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto, FieldErrorDto, ErrorMetaDto),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['status', 'message', 'errors'],
        properties: {
          status: { type: 'boolean', enum: [false], example: false },
          message: { type: 'string', example: message },
          errors: {
            type: 'object',
            required: ['value', 'meta'],
            properties: {
              value: { type: 'array', items: { $ref: getSchemaPath(FieldErrorDto) } },
              meta: { $ref: getSchemaPath(ErrorMetaDto) },
            },
          },
        },
      },
    }),
  );

/** 400 — request body failed DTO validation; `errors.value` names the offending fields. */
export const ApiValidationErrorResponse = (
  description = 'Request body failed validation. `errors.value` lists the offending fields.',
): MethodDecorator & ClassDecorator =>
  ApiErrorEnvelope(
    HttpStatus.BAD_REQUEST,
    description,
    CommonResponseMessage.fail.VALIDATION_FAILED,
  );

/** 401 + 403 — attach to every endpoint behind a guard. */
export const ApiAuthErrorResponses = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiErrorEnvelope(
      HttpStatus.UNAUTHORIZED,
      'Access token missing, expired, or revoked. The client should refresh and retry once.',
      CommonResponseMessage.fail.UNAUTHORIZED,
    ),
    ApiErrorEnvelope(
      HttpStatus.FORBIDDEN,
      'Authenticated, but this account may not perform the action (wrong owner, restricted, or missing permission).',
      CommonResponseMessage.fail.FORBIDDEN,
    ),
  );

/** 404 — resource does not exist or is not visible to the caller. */
export const ApiNotFoundErrorResponse = (
  message: string,
  description = 'The requested resource does not exist.',
): MethodDecorator & ClassDecorator => ApiErrorEnvelope(HttpStatus.NOT_FOUND, description, message);

/** 409 — the write conflicts with current state (duplicate key, stale version). */
export const ApiConflictErrorResponse = (
  message: string,
  description = 'The request conflicts with the current state of the resource.',
): MethodDecorator & ClassDecorator => ApiErrorEnvelope(HttpStatus.CONFLICT, description, message);

/** 429 — global throttle (120 req/min/IP) or a tighter per-route limit tripped. */
export const ApiTooManyRequestsResponse = (): MethodDecorator & ClassDecorator =>
  ApiErrorEnvelope(
    HttpStatus.TOO_MANY_REQUESTS,
    'Rate limit exceeded. Back off and retry after a short delay.',
    CommonResponseMessage.fail.TOO_MANY_REQUESTS,
  );
