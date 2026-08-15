import {
  ApiErrorResponse,
  ApiSuccessResponse,
  FieldError,
  ResponseMeta,
} from '../interfaces/api-response.interface';
import { Page } from '../pagination/cursor.util';
import {
  buildCursorMeta,
  buildOffsetMeta,
  CursorMetaInput,
  OffsetMetaInput,
} from '../pagination/pagination.util';

/**
 * The single place that shapes an outbound envelope.
 *
 * Handlers normally just return their payload and let the ResponseInterceptor call `success()` for
 * them; call these directly only when you need to attach custom `meta` (or build an error body
 * outside the exception filter). Either way the JSON shape is produced by this one class, so the
 * contract can never drift between modules.
 */
export class ResponseUtil {
  /**
   * Wraps a payload as a success envelope.
   *
   * @param message  A constant from the module's `response/response-message.ts` — never a literal.
   * @param value    The payload; goes to `data.value` verbatim.
   * @param meta     Side-channel data (pagination, counts, flags); goes to `data.meta`.
   */
  static success<T>(message: string, value: T, meta: ResponseMeta = {}): ApiSuccessResponse<T> {
    return {
      status: true,
      message,
      data: { value, meta },
    };
  }

  /**
   * Wraps a failure as an error envelope.
   *
   * @param message  Human-readable summary, safe to show in the app.
   * @param value    Machine-readable detail — field errors for validation, `[]` when there is none.
   * @param meta     Debug context (path, method, timestamp, status code).
   */
  static error(
    message: string,
    value: FieldError[] | unknown = [],
    meta: ResponseMeta = {},
  ): ApiErrorResponse {
    return {
      status: false,
      message,
      errors: { value, meta },
    };
  }

  /** Success envelope for a keyset-paginated list: items in `value`, cursor info in `meta`. */
  static cursorPaginated<T>(
    message: string,
    page: Page<T>,
    input: CursorMetaInput,
    extraMeta: ResponseMeta = {},
  ): ApiSuccessResponse<T[]> {
    return ResponseUtil.success(message, page.items, {
      ...buildCursorMeta(page, input),
      ...extraMeta,
    });
  }

  /** Success envelope for a page/limit list: items in `value`, page counters in `meta`. */
  static offsetPaginated<T>(
    message: string,
    items: T[],
    input: OffsetMetaInput,
    extraMeta: ResponseMeta = {},
  ): ApiSuccessResponse<T[]> {
    return ResponseUtil.success(message, items, {
      ...buildOffsetMeta(input),
      ...extraMeta,
    });
  }
}
