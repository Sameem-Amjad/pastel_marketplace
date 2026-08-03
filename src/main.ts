import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { patchBigIntJson } from './common/serialization/bigint';

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Native-Token', 'Idempotency-Key', 'X-CSRF-Token'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown props — never trust extra client input
      forbidNonWhitelisted: false,
      transform: true, // DTOs come back as class instances with coerced types
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('Pastel API')
    .setDescription('NestJS backend replacing Sharetribe Flex')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();
