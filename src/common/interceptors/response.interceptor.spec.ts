import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { CommonResponseMessage } from '../constants/response-message';
import { ApiSuccessResponse } from '../interfaces/api-response.interface';
import { Page } from '../pagination/cursor.util';
import { ResponseUtil } from '../utils/response.util';
import { ResponseInterceptor } from './response.interceptor';

/**
 * The interceptor is the half of the envelope contract that applies to *successes*, so these tests
 * pin the three payload shapes it has to tell apart and the meta it derives from the request.
 */
describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new ResponseInterceptor(reflector);
  });

  /** Minimal ExecutionContext double — the interceptor only reads the type, handler, class and query. */
  const context = (query: Record<string, unknown> = {}): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ query }) }),
    }) as unknown as ExecutionContext;

  const handlerReturning = (value: unknown): CallHandler => ({ handle: () => of(value) });

  const run = async (payload: unknown, query: Record<string, unknown> = {}): Promise<unknown> =>
    firstValueFrom(interceptor.intercept(context(query), handlerReturning(payload)) as never);

  it('wraps a plain resource and uses the fallback message when none is declared', async () => {
    const result = (await run({ id: 'u1' })) as ApiSuccessResponse<{ id: string }>;

    expect(result).toEqual({
      status: true,
      message: CommonResponseMessage.success.REQUEST_SUCCEEDED,
      data: { value: { id: 'u1' }, meta: {} },
    });
  });

  it('uses the @ResponseMessage metadata when the handler declares one', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === 'response:message' ? ('User fetched successfully.' as never) : (undefined as never),
      );

    const result = (await run({ id: 'u1' })) as ApiSuccessResponse<unknown>;

    expect(result.message).toBe('User fetched successfully.');
  });

  it('turns a Page into value=items plus cursor meta derived from the query', async () => {
    const page: Page<{ id: string }> = { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'CURSOR' };

    const result = (await run(page, { perPage: '24', cursor: 'PREV' })) as ApiSuccessResponse<
      { id: string }[]
    >;

    expect(result.data.value).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.data.meta).toEqual({
      perPage: 24,
      count: 2,
      nextCursor: 'CURSOR',
      hasNext: true,
      hasPrevious: true,
    });
  });

  it('reports hasNext=false on the last page and hasPrevious=false on the first', async () => {
    const page: Page<{ id: string }> = { items: [{ id: 'a' }], nextCursor: null };

    const result = (await run(page, { perPage: '10' })) as ApiSuccessResponse<unknown>;

    expect(result.data.meta).toMatchObject({ hasNext: false, hasPrevious: false, perPage: 10 });
  });

  it('does not double-wrap a handler that already returned an envelope', async () => {
    const envelope = ResponseUtil.success('Custom.', { id: 'u1' }, { extra: true });

    expect(await run(envelope)).toBe(envelope);
  });

  it('represents an empty body as null rather than dropping data.value', async () => {
    const result = (await run(undefined)) as ApiSuccessResponse<null>;

    expect(result.data).toEqual({ value: null, meta: {} });
  });

  it('passes the payload through untouched when the handler opts out', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === 'response:skip-wrapper' ? (true as never) : (undefined as never),
      );

    const raw = { status: 'ok' };

    expect(await run(raw)).toBe(raw);
  });
});
