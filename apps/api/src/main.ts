import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const port = config.get<number>('port') ?? 3000;
  const apiPrefix = config.get<string>('apiPrefix') ?? 'api';
  const corsOrigins = config.get<string[]>('corsOrigins') ?? ['http://localhost:5173'];

  // Behind a proxy/load balancer, trust X-Forwarded-* so req.ip is accurate.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix(apiPrefix);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // OpenAPI / Swagger docs at /<prefix>/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('OMS API')
    .setDescription('Production & Order Management System API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  Logger.log(`API ready at http://localhost:${port}/${apiPrefix}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/${apiPrefix}/docs`, 'Bootstrap');
}

void bootstrap();
