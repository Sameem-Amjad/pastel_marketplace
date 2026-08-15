import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { CommonResponseMessage } from '../constants/response-message';
import { ApiErrorResponse, FieldError } from '../interfaces/api-response.interface';
import { ResponseUtil } from '../utils/response.util';

/** What `toEnvelope` needs to decide the HTTP status separately from the JSON body. */
interface MappedError {
  status: number;
  message: string;
  value: FieldError[] | unknown;
}

/**
 * Global exception filter — the only place a failure response is written.
 *
 * Everything thrown anywhere in the request pipeline (guards, pipes, controllers, services, Prisma)
 * leaves as the same envelope:
 *
 *   { status: false, message, errors: { value, meta } }
 *
 * `errors.value` carries `[{ field, message }]` for validation failures and `[]` otherwise, so the
 * Expo client has exactly one error-handling path: read `message` for the toast, read `errors.value`
 * to highlight form fields.
 *
 * Prisma errors with a natural HTTP meaning are mapped here (unique violation → 409, missing record →
 * 404, FK violation → 422) so services can let them bubble instead of hand-translating everywhere.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const mapped = this.map(exception);

    if (mapped.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.originalUrl ?? req.url} → ${mapped.status}: ${mapped.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // A streamed/already-committed response can't be rewritten; bailing beats an ERR_HTTP_HEADERS_SENT.
    if (res.headersSent) return;

    res.status(mapped.status).json(this.toEnvelope(mapped, req));
  }

  private toEnvelope(mapped: MappedError, req: Request): ApiErrorResponse {
    const requestId = req.headers['x-request-id'];

    return ResponseUtil.error(mapped.message, mapped.value, {
      statusCode: mapped.status,
      path: req.originalUrl ?? req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
      ...(typeof requestId === 'string' ? { requestId } : {}),
    });
  }

  private map(exception: unknown): MappedError {
    if (exception instanceof HttpException) return this.fromHttpException(exception);
    if (exception instanceof Prisma.PrismaClientKnownRequestError)
      return this.fromPrisma(exception);
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: CommonResponseMessage.fail.BAD_REQUEST,
        value: [],
      };
    }

    // Nothing recognised the failure — never surface internals to the client, log the stack instead.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: CommonResponseMessage.fail.INTERNAL_SERVER_ERROR,
      value: [],
    };
  }

  private fromHttpException(exception: HttpException): MappedError {
    const status = exception.getStatus();
    const body = exception.getResponse();

    // ThrottlerException carries a developer-facing string ("ThrottlerException: Too Many Requests").
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return { status, message: CommonResponseMessage.fail.TOO_MANY_REQUESTS, value: [] };
    }

    if (typeof body === 'string') {
      return { status, message: this.preferOwnMessage(body, status), value: [] };
    }

    const payload = body as Record<string, unknown>;

    // Our validationExceptionFactory shape: { message, errors: [{ field, message }] }.
    if (Array.isArray(payload.errors)) {
      return {
        status,
        message:
          typeof payload.message === 'string'
            ? this.preferOwnMessage(payload.message, status)
            : this.defaultMessage(status),
        value: payload.errors,
      };
    }

    // A ValidationPipe left on Nest's default factory: message is a string[] of prose.
    if (Array.isArray(payload.message)) {
      return {
        status,
        message: CommonResponseMessage.fail.VALIDATION_FAILED,
        value: payload.message.map((message) => ({ field: 'unknown', message: String(message) })),
      };
    }

    return {
      status,
      message:
        typeof payload.message === 'string'
          ? this.preferOwnMessage(payload.message, status)
          : this.defaultMessage(status),
      value: [],
    };
  }

  /**
   * Keeps a message a developer actually wrote ("Order not found"), but replaces the bare HTTP status
   * phrase Nest defaults to when an exception was thrown with no argument ("Not Found") — the client
   * should see our copy, not the RFC reason phrase.
   */
  private preferOwnMessage(message: string, status: number): string {
    return message === STATUS_CODES[status] ? this.defaultMessage(status) : message;
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): MappedError {
    switch (e.code) {
      case 'P2002': // unique constraint violated
        return {
          status: HttpStatus.CONFLICT,
          message: CommonResponseMessage.fail.CONFLICT,
          value: this.uniqueTargets(e).map((field) => ({
            field,
            message: `${field} is already in use.`,
          })),
        };
      case 'P2025': // record required but not found
        return {
          status: HttpStatus.NOT_FOUND,
          message: CommonResponseMessage.fail.NOT_FOUND,
          value: [],
        };
      case 'P2003': // foreign-key violation
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: CommonResponseMessage.fail.UNPROCESSABLE_ENTITY,
          value: [],
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: CommonResponseMessage.fail.INTERNAL_SERVER_ERROR,
          value: [],
        };
    }
  }

  /** P2002's `meta.target` is the column list that collided — usually a single field like `email`. */
  private uniqueTargets(e: Prisma.PrismaClientKnownRequestError): string[] {
    const target = e.meta?.target;
    if (Array.isArray(target)) return target.map(String);
    if (typeof target === 'string') return [target];
    return [];
  }

  private defaultMessage(status: number): string {
    const { fail } = CommonResponseMessage;
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return fail.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return fail.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return fail.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return fail.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return fail.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return fail.UNPROCESSABLE_ENTITY;
      case HttpStatus.TOO_MANY_REQUESTS:
        return fail.TOO_MANY_REQUESTS;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return fail.SERVICE_UNAVAILABLE;
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? fail.INTERNAL_SERVER_ERROR
          : fail.BAD_REQUEST;
    }
  }
}
