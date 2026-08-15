import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { CommonResponseMessage } from './constants/response-message';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { PrismaService } from './prisma/prisma.service';
import { ReadPrismaService } from './prisma/read-prisma.service';
import { validationExceptionFactory } from './utils/validation-exception.factory';
import { AuthResponseMessage } from '../modules/identity/response/response-message';

/**
 * End-to-end proof that the envelope reaches the wire — the interceptor, the filter, the validation
 * factory, the global prefix and URI versioning all wired together exactly as `main.ts` wires them.
 *
 * The unit specs next to each piece cover the branches; this one guarantees they compose, which is
 * the part a refactor is most likely to break silently.
 *
 * Prisma is stubbed: every route exercised here fails or answers before touching the database.
 */
describe('response contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const prismaStub = { $connect: async () => {}, $disconnect: async () => {}, $on: () => {} };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(ReadPrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['healthz', 'readyz'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        exceptionFactory: validationExceptionFactory,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('wraps a success in { status, message, data: { value, meta } }', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/info').expect(200);

    expect(res.body).toEqual({
      status: true,
      message: AuthResponseMessage.success.AUTH_INFO_FETCHED,
      data: {
        value: { isAnonymous: true, scopes: ['public-read'], userId: null },
        meta: {},
      },
    });
  });

  it('wraps a validation failure with per-field errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.body.status).toBe(false);
    expect(res.body.message).toBe(CommonResponseMessage.fail.VALIDATION_FAILED);
    expect(res.body.errors.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'password' }),
      ]),
    );
    expect(res.body.errors.meta).toMatchObject({
      statusCode: 400,
      path: '/api/v1/auth/signup',
      method: 'POST',
    });
  });

  it('wraps an auth failure from a global guard in the same envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);

    expect(res.body.status).toBe(false);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.errors.value).toEqual([]);
    expect(res.body.errors.meta).toMatchObject({ statusCode: 401, path: '/api/v1/me' });
  });

  it("wraps a 404 from an unknown route rather than emitting Nest's default body", async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(res.body.status).toBe(false);
    expect(res.body).toHaveProperty('errors.value');
  });

  it('serves every route under /api/v1', async () => {
    await request(app.getHttpServer()).get('/auth/info').expect(404);
  });

  it('leaves the health probes unversioned and unwrapped for the load balancer', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);

    expect(res.body).toEqual({ status: 'ok' });
  });
});
