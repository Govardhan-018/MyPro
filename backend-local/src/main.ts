// Must come first: AppModule decides which modules to load from env at
// import time, so the .env file has to be in process.env before that.
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const config = env();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Never leak stack traces / framework details to the client.
    logger: config.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : ['debug', 'verbose', 'error', 'warn', 'log'],
  });

  // Behind Caddy/nginx: trust exactly one proxy hop so rate limiting sees the real IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers. This is a JSON API, so lock the CSP right down.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );

  app.use(compression());

  // Strict allowlist. Single-user system: no wildcard origins, ever.
  app.enableCors({
    origin: (origin, cb) => {
      // Allow non-browser callers (mobile app, curl) which send no Origin.
      if (!origin || config.CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false, // we use Bearer tokens, not cookies → no CSRF surface
    maxAge: 600,
  });

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    }),
  );

  // Cap request bodies — nothing we accept is large.
  app.useBodyParser('json', { limit: '1mb' });

  // Request bodies are validated per-route with zod schemas (see controllers).
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`MyPro API listening on :${config.PORT} (${config.NODE_ENV})`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal boot error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
