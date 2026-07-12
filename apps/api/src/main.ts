import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { buildCorsOrigin } from './common/cors-origin.util';
import { UPLOADS_URL_PREFIX, ensureUploadDir } from './uploads/uploads.constants';

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
  // This project's on-prem deployment (start.bat) runs the packaged server
  // without ever setting NODE_ENV=production, so `isProduction` alone can't be
  // trusted to detect "this is the real deployment" — use the same signal the
  // web-app static handler below already relies on instead.
  const webDist = join(__dirname, '..', '..', '..', 'web', 'dist');
  const webIndex = join(webDist, 'index.html');
  const isPackagedBuild = existsSync(webIndex);

  // Same-origin policy shared with the WebSocket gateway — see cors-origin.util.ts.
  const corsOrigin = buildCorsOrigin({ isProduction, corsOrigins });

  // Behind a proxy/load balancer, trust X-Forwarded-* so req.ip is accurate.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix(apiPrefix);
  // CSP is disabled because this same server also serves the bundled web app
  // (single-origin, offline-friendly). The strict default CSP would block the
  // SPA's own assets; everything is local so this is safe here.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Gzip every compressible response (JSON lists, served web assets). Big
  // payloads shrink ~4-10x, which is what makes the app usable over slow
  // links (phone via the router's OpenVPN) instead of taking seconds per screen.
  app.use(compression());
  // Let browsers STORE GET responses but always revalidate them. Express already
  // sends ETags, so an unchanged payload revalidates as a 0-byte 304 — over a
  // slow link (phone on OpenVPN) that turns repeat fetches of big lookup lists
  // from full downloads into a single round-trip. `private` keeps any shared
  // proxy from caching per-user data. Static handlers below set their own
  // Cache-Control, overriding this for files.
  app.use((req: { method: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    if (req.method === 'GET') res.setHeader('Cache-Control', 'private, no-cache');
    next();
  });
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

  // OpenAPI / Swagger docs at /<prefix>/docs. SwaggerModule mounts its routes
  // directly on the underlying Express instance, bypassing Nest's guard
  // pipeline entirely — so unlike every real endpoint, this page and its raw
  // JSON schema are NOT covered by the global JwtAuthGuard. That's fine for
  // local development, but on a real deployment it would hand any visitor the
  // full API surface (every route, DTO shape, param name) with zero auth —
  // pure reconnaissance value for an attacker, so it's dev-only.
  if (!isProduction && !isPackagedBuild) {
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
  }

  // Serve user-uploaded files (order-line photos) from the project's /uploads
  // folder at `${prefix}/uploads`. Served as plain static assets — no Nest guard
  // runs, so <img> tags load them without a bearer token. The path sits under
  // `/api` so the Vite dev proxy routes it here unchanged.
  //
  // Defense in depth: the upload endpoint already validates real image bytes
  // (see uploads.controller.ts) so nothing except a genuine image should ever
  // land here, but user-generated content is still the classic stored-XSS
  // vector — `Content-Security-Policy: sandbox` strips scripting/origin
  // privileges from anything served under this path (harmless to real images,
  // neutralises a maliciously uploaded HTML/SVG file even if one slipped
  // through) and `nosniff` stops the browser from guessing a different type.
  const uploadsDir = ensureUploadDir();
  app.useStaticAssets(uploadsDir, {
    prefix: UPLOADS_URL_PREFIX,
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', 'sandbox');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });
  Logger.log(`Uploads served from ${uploadsDir} at ${UPLOADS_URL_PREFIX}`, 'Bootstrap');

  // Serve the built web app from this same server when a production build exists,
  // so the whole OMS runs from ONE process on ONE URL (offline-friendly). Real
  // files (JS/CSS/images) are served directly; every other non-API GET falls back
  // to index.html for the SPA's client-side routing.
  if (isPackagedBuild) {
    // Serve the local mkcert root CA with the proper certificate MIME so a phone
    // opening /oms-rootCA.crt is offered "Install profile" (tap → Install →
    // trust) instead of just downloading an unrecognised file. Installing it
    // once per phone removes the "Not secure" warning permanently, even across
    // server restarts (the leaf cert changes, but the root CA stays the same).
    // Registered before the static handler so it wins and sets the right type.
    const caFile = join(webDist, 'oms-rootCA.crt');
    if (existsSync(caFile)) {
      app
        .getHttpAdapter()
        .getInstance()
        .get('/oms-rootCA.crt', (_req: unknown, res: { setHeader: (k: string, v: string) => void; sendFile: (p: string) => void }) => {
          res.setHeader('Content-Type', 'application/x-x509-ca-cert');
          res.sendFile(caFile);
        });
    }

    app.useStaticAssets(webDist, { index: false });
    app
      .getHttpAdapter()
      .getInstance()
      .get(/^\/(?!api\/).*/, (_req: unknown, res: { sendFile: (p: string) => void }) => res.sendFile(webIndex));
    Logger.log(`Web app served from ${webDist}`, 'Bootstrap');
  }

  // Listen on all interfaces so the API is reachable on this machine's LAN IP.
  await app.listen(port, '0.0.0.0');
  // Keep idle connections open well past Node's 5s default. Over the router's
  // OpenVPN a new TCP+TLS setup costs whole seconds, so letting the proxy (and
  // direct clients) reuse connections between a user's clicks matters.
  const httpServer = app.getHttpServer() as { keepAliveTimeout: number; headersTimeout: number };
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  const webNote = isPackagedBuild ? ` · Web app at http://localhost:${port}/` : '';
  Logger.log(`API ready on http://localhost:${port}/${apiPrefix} (and this machine's LAN IP)${webNote}`, 'Bootstrap');
  if (!isProduction && !isPackagedBuild) Logger.log(`Swagger docs at http://localhost:${port}/${apiPrefix}/docs`, 'Bootstrap');
}

void bootstrap();
