import { randomBytes, randomUUID } from 'crypto';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import RedisStore from 'connect-redis';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import type Redis from 'ioredis';
import passport from 'passport';
import { pinoHttp } from 'pino-http';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LocalsInterceptor } from './common/interceptors/locals.interceptor';
import { HtmxRenderInterceptor } from './common/interceptors/render.interceptor';
import { configureBullBoard } from './common/queues/bull-board';
import { REDIS_CLIENT } from './common/redis/redis.constants';
import { doubleCsrfProtection } from './common/security/csrf';
import { configureViews } from './common/view/nunjucks';
import { UsersService } from './modules/users/users.service';

/** Shared production and e2e Express/Nest middleware wiring. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance();
  const production = config.get<string>('NODE_ENV') === 'production';

  app.set('trust proxy', config.get<boolean>('TRUST_PROXY') ?? false);
  app.use(
    pinoHttp({
      level: config.get<string>('NODE_ENV') === 'test' ? 'silent' : (config.get<string>('LOG_LEVEL') ?? 'info'),
      genReqId: (req, res) => {
        const requestId = req.headers['x-request-id'];
        const id = typeof requestId === 'string' && requestId.length <= 128 ? requestId : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.rawText',
          'req.body.resumeText',
          'req.body.cvText',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-eval'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? null : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  // Parse bodies before CSRF so its _csrf fallback is available.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const redisClient = app.get<Redis>(REDIS_CLIENT);
  app.use(
    session({
      store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
      secret: config.getOrThrow<string>('SESSION_SECRET'),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user: Express.User, done) => done(null, (user as { id: string }).id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await app.get(UsersService).findById(id);
      done(null, user ?? false);
    } catch (error) {
      done(error);
    }
  });

  app.use(cookieParser());
  app.use(doubleCsrfProtection);
  configureBullBoard(app);

  const staticOptions = { maxAge: production ? '1d' : 0, etag: true };
  app.useStaticAssets(join(__dirname, '..', 'public'), staticOptions);
  app.useStaticAssets(join(__dirname, '..', 'node_modules', 'htmx.org', 'dist'), {
    prefix: '/vendor/htmx',
    maxAge: production ? '1y' : 0,
    immutable: production,
  });
  app.useStaticAssets(join(__dirname, '..', 'node_modules', 'alpinejs', 'dist'), {
    prefix: '/vendor/alpine',
    maxAge: production ? '1y' : 0,
    immutable: production,
  });
  app.useStaticAssets(join(__dirname, '..', 'node_modules', 'sortablejs'), {
    prefix: '/vendor/sortable',
    maxAge: production ? '1y' : 0,
    immutable: production,
  });
  configureViews(expressApp);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LocalsInterceptor(), new HtmxRenderInterceptor());
}
