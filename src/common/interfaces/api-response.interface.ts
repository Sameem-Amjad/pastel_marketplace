/**
 * The single response contract every endpoint speaks (success AND failure).
 *
 * The React Native (Expo) client can therefore branch on exactly one discriminator — `status` — and
 * always find the payload at `data.value` / the errors at `errors.value`, with any side-channel
 * information (pagination, request id, ...) at `*.meta`.
 *
 *   success → { status: true,  message, data:   { value, meta } }
 *   failure → { status: false, message, errors: { value, meta } }
 *
 * Nothing else is ever written to the wire: the ResponseInterceptor wraps controller returns and the
 * HttpExceptionFilter wraps thrown exceptions, so a handler cannot accidentally emit a bare object.
 */

/** One field-level validation failure. `field` is the dot-path into the request body (`address.city`). */
export interface FieldError {
  field: string;
  message: string;
}

/** Free-form side-channel data. Always present (`{}` when there is nothing to say). */
export type ResponseMeta = Record<string, unknown>;

/**
 * Meta for classic page/limit list endpoints.
 *
 * Declared as a type alias, not an interface, so it stays assignable to {@link ResponseMeta} —
 * TypeScript only infers an implicit index signature for anonymous object types.
 */
export type OffsetPaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

/**
 * Meta for keyset (cursor) list endpoints — what most list endpoints here use, because OFFSET scans
 * and discards rows and so degrades linearly with depth (doc 05). `nextCursor` is the opaque token the
 * client echoes back as `?cursor=` to fetch the following page.
 */
export type CursorPaginationMeta = {
  perPage: number;
  count: number;
  nextCursor: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Approximate total where the query can afford one — exact COUNT is too costly on large tables. */
  approxTotal?: number;
};

export type PaginationMeta = OffsetPaginationMeta | CursorPaginationMeta;

export interface ApiSuccessResponse<T> {
  status: true;
  message: string;
  data: {
    value: T;
    meta: ResponseMeta;
  };
}

export interface ApiErrorResponse {
  status: false;
  message: string;
  errors: {
    /** Field-level errors for validation failures; `[]` when the failure has no per-field detail. */
    value: FieldError[] | unknown;
    meta: ResponseMeta;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * True when a handler already returned a fully-formed envelope (e.g. it called `ResponseUtil.success`
 * directly to attach custom meta). The interceptor uses this to avoid double-wrapping.
 */
export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.status !== 'boolean') return false;
  if (typeof candidate.message !== 'string') return false;
  return candidate.status === true ? 'data' in candidate : 'errors' in candidate;
}
