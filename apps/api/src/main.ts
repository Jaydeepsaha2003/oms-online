import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Excel imports post every row as JSON — a filled template can be thousands of
  // rows, so lift the default ~100 KB body limit well above that.
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  const port = config.get<number>('port') ?? 3000;
  const apiPrefix = config.get<string>('apiPrefix') ?? 'api';
  const corsOrigins = config.get<string[]>('corsOrigins') ?? ['http://localhost:5173'];
  const isProduction = config.get<boolean>('isProduction') ?? false;

  // In dev, also accept requests from localhost and private-LAN addresses on any
  // port, so the app is reachable from phones/other devices on the same network.
  // credentials:true forbids a wildcard origin, so we reflect allowed ones per request.
  const privateLanOrigin =
    /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;
  const corsOrigin = isProduction
    ? corsOrigins
    : (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ): void => {
        // Non-browser clients (curl, native mobile apps) send no Origin header.
        // Deny by withholding CORS headers (browser blocks it) rather than throwing
        // a 500 — keeps the request servable for non-browser callers.
        const allowed = !origin || corsOrigins.includes(origin) || privateLanOrigin.test(origin);
        callback(null, allowed);
      };

  // Behind a proxy/load balancer, trust X-Forwarded-* so req.ip is accurate.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix(apiPrefix);
  // CSP is disabled because this same server also serves the bundled web app
  // (single-origin, offline-friendly). The strict default CSP would block the
  // SPA's own assets; everything is local so this is safe here.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigin, credentials: true });
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

  // Serve the built web app from this same server when a production build exists,
  // so the whole OMS runs from ONE process on ONE URL (offline-friendly). Real
  // files (JS/CSS/images) are served directly; every other non-API GET falls back
  // to index.html for the SPA's client-side routing.
  const webDist = join(__dirname, '..', '..', '..', 'web', 'dist');
  const webIndex = join(webDist, 'index.html');
  if (existsSync(webIndex)) {
    app.useStaticAssets(webDist, { index: false });
    app
      .getHttpAdapter()
      .getInstance()
      .get(/^\/(?!api\/).*/, (_req: unknown, res: { sendFile: (p: string) => void }) => res.sendFile(webIndex));
    Logger.log(`Web app served from ${webDist}`, 'Bootstrap');
  }

  // Listen on all interfaces so the API is reachable on this machine's LAN IP.
  await app.listen(port, '0.0.0.0');
  const webNote = existsSync(webIndex) ? ` · Web app at http://localhost:${port}/` : '';
  Logger.log(`API ready on http://localhost:${port}/${apiPrefix} (and this machine's LAN IP)${webNote}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/${apiPrefix}/docs`, 'Bootstrap');
}

void bootstrap();
