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
import type { NextFunction, Request, Response } from 'express';
import { THUMBS_URL_PREFIX, serveThumbnail } from './uploads/thumbnails';
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
  /*
   * Defense in depth, WITHOUT `sandbox`.
   *
   * This used to send `Content-Security-Policy: sandbox`, and that is why
   * uploaded photos never appeared on an iPhone while desktop and Android were
   * fine. The sandbox directive is specified for documents; Blink (Chrome,
   * Edge, Android) ignores it on an image subresource, WebKit does not — and
   * every browser on iOS is WebKit, so Safari, Chrome-for-iOS and Firefox-for-
   * iOS all refused to render the photo. The page itself was unaffected, which
   * is exactly what it looked like: the layout drew, the pictures did not. This
   * header was on the uploads path and nowhere else in the app, which is why
   * nothing else on the page was affected.
   *
   * `default-src 'none'` replaces it and is the header GitHub and friends use
   * for user content. If one of these files were ever loaded AS a document it
   * could run no script and fetch nothing; unlike `sandbox` it says nothing
   * about whether a parent page may display it, so images render everywhere.
   *
   * What is NOT being given up: the upload endpoint identifies the format from
   * its magic bytes and stores the file under a server-generated
   * `<uuid><ext>` — the client's filename and Content-Type never reach the
   * disk. SVG is not in that list at all, so the one script-capable image
   * format can never be stored, and an HTML payload declared as image/png is
   * rejected before it is written. With `nosniff` below pinning the type the
   * browser is told, there is no path left for a stored file to be parsed as
   * markup.
   */
  const uploadsDir = ensureUploadDir();
  // Grid thumbnails — before the static handler so `/thumbs/...` is never
  // looked up as a real file. See uploads/thumbnails.ts.
  app.use(THUMBS_URL_PREFIX, (req: Request, res: Response, next: NextFunction) => void serveThumbnail(req, res, next));
  app.useStaticAssets(uploadsDir, {
    prefix: UPLOADS_URL_PREFIX,
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'");
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
      // SPA fallback — but ONLY for real app routes, never for paths that look
      // like a file. Sending index.html for a missing asset answers 200 with
      // HTML, which is worse than a 404 in every case: a browser asking for
      // /icons/icon-192-v4.png (an app installed before the icon rename) would
      // get HTML it then tries to decode as a PNG, and the service worker's
      // network-first branch would happily cache that HTML under the icon's
      // URL. A 404 instead lets the client fall back and re-read the manifest.
      // Same rule the service worker already uses for navigations, so the two
      // agree on what counts as a file. Anything with an extension falls
      // through to Nest's 404.
      .get(/^\/(?!api\/).*/, (req: { path: string }, res: { sendFile: (p: string) => void }, next: () => void) => {
        if (/\.[a-z0-9]+$/i.test(req.path)) return next();
        res.sendFile(webIndex);
      });
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
