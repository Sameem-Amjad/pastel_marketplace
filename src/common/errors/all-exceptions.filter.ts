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

/** RFC-7807 problem+json body (doc 06: new REST surface). */
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: unknown;
}

/**
 * Global exception filter → RFC-7807 problem+json. Also maps the Prisma errors that have a natural HTTP
 * meaning (unique violation → 409, record not found → 404) so services can let them bubble instead of
 * hand-translating everywhere (DRY).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, req.url);

    if (problem.status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${problem.status}: ${problem.detail ?? problem.title}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail = typeof body === 'string' ? body : (body as Record<string, unknown>).message;
      return {
        type: 'about:blank',
        title: HttpStatus[status] ?? 'Error',
        status,
        detail: Array.isArray(detail) ? undefined : (detail as string),
        errors: Array.isArray(detail) ? detail : undefined,
        instance,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception, instance);
    }

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError, instance: string): ProblemDetails {
    switch (e.code) {
      case 'P2002': // unique constraint
        return {
          type: 'about:blank',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail: `Unique constraint failed on ${JSON.stringify(e.meta?.target)}`,
          instance,
        };
      case 'P2025': // record not found
        return {
          type: 'about:blank',
          title: 'Not Found',
          status: HttpStatus.NOT_FOUND,
          detail: (e.meta?.cause as string) ?? 'Record not found',
          instance,
        };
      case 'P2003': // FK violation
        return {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          detail: 'Referenced record does not exist',
          instance,
        };
      default:
        return {
          type: 'about:blank',
          title: 'Internal Server Error',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          detail: `Database error ${e.code}`,
          instance,
        };
    }
  }
}
