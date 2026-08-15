import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ThrottlerException } from '@nestjs/throttler';
import { CommonResponseMessage } from '../constants/response-message';
import { ApiErrorResponse } from '../interfaces/api-response.interface';
import { validationExceptionFactory } from '../utils/validation-exception.factory';
import { HttpExceptionFilter } from './http-exception.filter';

/**
 * The filter is the half of the envelope contract that applies to *failures*. These tests pin the
 * mapping from each exception family to (status, message, errors.value) — the three things the Expo
 * client branches on.
 */
describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let status: jest.Mock;
  let json: jest.Mock;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    // 5xx paths log a stack; keep the suite output clean.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const host = (): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({ status, headersSent: false }),
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/v1/users',
          url: '/api/v1/users',
          headers: {},
        }),
      }),
    }) as unknown as ArgumentsHost;

  const capture = (exception: unknown): { code: number; body: ApiErrorResponse } => {
    filter.catch(exception, host());
    return {
      code: status.mock.calls[0][0] as number,
      body: json.mock.calls[0][0] as ApiErrorResponse,
    };
  };

  it('always emits the failure envelope shape, with debug context in errors.meta', () => {
    const { body } = capture(new NotFoundException('Order not found.'));

    expect(body.status).toBe(false);
    expect(body).toHaveProperty('errors.value');
    expect(body.errors.meta).toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
      path: '/api/v1/users',
      method: 'POST',
    });
    expect(body.errors.meta).toHaveProperty('timestamp');
  });

  it('lifts field errors out of a validation failure', () => {
    const exception = validationExceptionFactory([
      { property: 'email', constraints: { isEmail: 'email must be an email' }, children: [] },
    ]);

    const { code, body } = capture(exception);

    expect(code).toBe(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe(CommonResponseMessage.fail.VALIDATION_FAILED);
    expect(body.errors.value).toEqual([{ field: 'email', message: 'email must be an email' }]);
  });

  it('keeps a message the developer wrote', () => {
    const { code, body } = capture(new ForbiddenException('You are not a party to this order.'));

    expect(code).toBe(HttpStatus.FORBIDDEN);
    expect(body.message).toBe('You are not a party to this order.');
  });

  it('replaces the bare HTTP reason phrase Nest defaults to with our own copy', () => {
    const { body } = capture(new NotFoundException());

    expect(body.message).toBe(CommonResponseMessage.fail.NOT_FOUND);
  });

  it('gives the throttler a client-facing message instead of its internal one', () => {
    const { code, body } = capture(new ThrottlerException());

    expect(code).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(body.message).toBe(CommonResponseMessage.fail.TOO_MANY_REQUESTS);
  });

  it('maps a Prisma unique violation to 409 and names the colliding field', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['email'] },
    });

    const { code, body } = capture(exception);

    expect(code).toBe(HttpStatus.CONFLICT);
    expect(body.errors.value).toEqual([{ field: 'email', message: 'email is already in use.' }]);
  });

  it('maps a Prisma missing record to 404', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });

    expect(capture(exception).code).toBe(HttpStatus.NOT_FOUND);
  });

  it('maps a Prisma foreign-key violation to 422', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('FK violation', {
      code: 'P2003',
      clientVersion: '5.22.0',
    });

    expect(capture(exception).code).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('never leaks internals from an unrecognised error', () => {
    const { code, body } = capture(new Error('connect ECONNREFUSED 10.0.0.4:5432'));

    expect(code).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe(CommonResponseMessage.fail.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it("still converts a ValidationPipe left on Nest's default string[] factory", () => {
    const { body } = capture(new BadRequestException({ message: ['title should not be empty'] }));

    expect(body.message).toBe(CommonResponseMessage.fail.VALIDATION_FAILED);
    expect(body.errors.value).toEqual([{ field: 'unknown', message: 'title should not be empty' }]);
  });

  it('does not rewrite a response that has already been committed', () => {
    const committed = {
      switchToHttp: () => ({
        getResponse: () => ({ status, headersSent: true }),
        getRequest: () => ({ method: 'GET', url: '/api/v1/x', headers: {} }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new ConflictException('too late'), committed);

    expect(status).not.toHaveBeenCalled();
  });
});
