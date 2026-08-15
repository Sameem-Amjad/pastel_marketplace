import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import {
  ApiErrorResponseDto,
  ErrorMetaDto,
  FieldErrorDto,
  PaginationMetaDto,
} from './common/dto/api-response.dto';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { patchBigIntJson } from './common/serialization/bigint';
import { validationExceptionFactory } from './common/utils/validation-exception.factory';

/** Probes answer the load balancer, so they sit outside `/api/v1` and never move with a version bump. */
const UNVERSIONED_ROUTES = ['healthz', 'readyz'];

async function bootstrap(): Promise<void> {
  patchBigIntJson();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<AppConfig, true>);

  app.use(helmet());

  // Native (Capacitor/Ionic) origins + web. WKWebView can't share the cookie jar, hence X-Native-Token.
  app.enableCors({
    origin: [
      /\.mypastel\.com$/,
      'capacitor://localhost',
      'https://localhost',
      'ionic://localhost',
      'http://localhost:3000',
    ],
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Native-Token',
      'Idempotency-Key',
      'X-CSRF-Token',
    ],
  });

  // URI versioning → every route is served under /api/v1/... so a future breaking change can ship as
  // /api/v2 while installed app versions keep working against v1.
  app.setGlobalPrefix('api', { exclude: UNVERSIONED_ROUTES });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown props — never trust extra client input
      forbidNonWhitelisted: false,
      transform: true, // DTOs come back as class instances with coerced types
      transformOptions: { enableImplicitConversion: false },
      // Emit `[{ field, message }]` instead of Nest's flat string[], so the app can bind each message
      // to its form input (see common/utils/validation-exception.factory.ts).
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // The response envelope's other half — ResponseInterceptor — is registered in AppModule so it can
  // inject Reflector and read @ResponseMessage.
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('Pastel API')
    .setDescription(
      [
        'NestJS backend replacing Sharetribe Flex. Consumed by the Pastel React Native (Expo) app.',
        '',
        '## Response envelope',
        '',
        'Every endpoint returns the same two shapes — there are no exceptions apart from the',
        'unversioned `/healthz` and `/readyz` probes.',
        '',
        '**Success**',
        '```json',
        '{ "status": true, "message": "Listing fetched successfully.",',
        '  "data": { "value": { }, "meta": { } } }',
        '```',
        '',
        '**Failure**',
        '```json',
        '{ "status": false, "message": "Validation failed.",',
        '  "errors": { "value": [{ "field": "email", "message": "Email is required" }],',
        '              "meta": { "statusCode": 400, "path": "/api/v1/auth/signup",',
        '                        "method": "POST", "timestamp": "2026-08-14T10:00:00.000Z" } } }',
        '```',
        '',
        'Branch on `status`; read the payload at `data.value` and field errors at `errors.value`.',
        '',
        '## Pagination',
        '',
        'List endpoints are **cursor**-paginated, not page-numbered: read `data.meta.nextCursor`, send',
        'it back as `?cursor=`, and stop when `data.meta.hasNext` is `false`. Keyset paging keeps',
        'latency flat at any scroll depth, which is what the feeds need — so there is no page number',
        'and no exact total. Request pages in order.',
        '',
        '## Money',
        '',
        'Every amount is an integer in **minor units** (cents): `24999` means £249.99. Never send or',
        'expect a decimal.',
        '',
        '## Authentication',
        '',
        'Send `Authorization: Bearer <accessToken>`. Refresh with `POST /auth/refresh` when the token',
        'expires (`expiresIn` seconds); refresh tokens rotate, so store the new one each time.',
        '',
        '## Rate limiting',
        '',
        '120 requests/minute/IP globally, 10/minute on `POST /auth/login`. Exceeding either returns',
        '`429` in the standard error envelope.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from /auth/login.',
      },
      'bearer',
    )
    .addServer('/api/v1', 'Version 1')
    .build();

  const document = SwaggerModule.createDocument(app, swagger, {
    // Envelope models are referenced from hand-built schemas, so Swagger can't discover them by
    // reflection — register them explicitly or the $refs dangle.
    extraModels: [ApiErrorResponseDto, FieldErrorDto, ErrorMetaDto, PaginationMetaDto],
  });
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', docExpansion: 'none' },
  });

  const port = config.get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();
