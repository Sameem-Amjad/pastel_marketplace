import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { CommonResponseMessage } from '../constants/response-message';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { SKIP_RESPONSE_WRAPPER_KEY } from '../decorators/skip-response-wrapper.decorator';
import {
  ApiSuccessResponse,
  isApiResponse,
  ResponseMeta,
} from '../interfaces/api-response.interface';
import { Page } from '../pagination/cursor.util';
import { buildCursorMeta } from '../pagination/pagination.util';
import { ResponseUtil } from '../utils/response.util';

/**
 * Wraps every successful controller return in the standard success envelope.
 *
 * Handlers stay clean — they return the resource (or a `Page<T>`) and nothing else — while the wire
 * format stays uniform. Three payload shapes are recognised:
 *
 *   1. an envelope already      → passed through untouched (handler called ResponseUtil itself)
 *   2. a `Page<T>`              → `value` = items, `meta` = cursor pagination block
 *   3. anything else            → `value` = payload, `meta` = {}
 *
 * The message comes from @ResponseMessage on the handler (or its controller), falling back to a
 * generic success string.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    // Non-HTTP contexts (scheduled jobs, future queue consumers) have no envelope to speak of.
    if (context.getType() !== 'http') return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_WRAPPER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? CommonResponseMessage.success.REQUEST_SUCCEEDED;

    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(map((payload) => this.wrap(payload, message, request)));
  }

  private wrap(payload: unknown, message: string, request: Request): unknown {
    if (isApiResponse(payload)) return payload;

    if (isPage(payload)) {
      return ResponseUtil.success(message, payload.items, this.cursorMeta(payload, request));
    }

    return ResponseUtil.success(message, payload ?? null);
  }

  /**
   * Cursor meta is completed from the request itself: the page size and whether a `?cursor=` was sent
   * are the only two facts `Page<T>` does not carry, and both live in the query string.
   */
  private cursorMeta(page: Page<unknown>, request: Request): ResponseMeta {
    const raw = request.query?.perPage;
    const parsed = Number.parseInt(String(raw ?? ''), 10);

    return buildCursorMeta(page, {
      perPage: Number.isFinite(parsed) && parsed > 0 ? parsed : page.items.length,
      hasPrevious: Boolean(request.query?.cursor),
    });
  }
}

/** Structural check for the keyset page envelope produced by `buildPage` (common/pagination). */
function isPage(value: unknown): value is Page<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.items) && 'nextCursor' in candidate;
}

/** Re-exported for tests that assert on the envelope type. */
export type { ApiSuccessResponse };
