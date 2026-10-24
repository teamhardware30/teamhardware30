import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { doubleCsrfProtection } from './common/security/csrf';
import { configureViews } from './common/view/nunjucks';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HtmxRenderInterceptor } from './common/interceptors/render.interceptor';
import { LocalsInterceptor } from './common/interceptors/locals.interceptor';
import { UsersService } from './modules/users/users.service';

/**
 * Shared Express/Nest wiring (session, passport, CSRF, views, global
 * filters/interceptors) used by both the production entrypoint and
 * e2e tests, so tests exercise the exact same middleware stack.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance();

  const redisClient = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');

  // Registered explicitly (rather than relying on Nest's own default
  // body-parser) so req.body is reliably populated before the CSRF
  // middleware below reads it — Nest's implicit parser isn't guaranteed
  // to run ahead of middleware added here via app.use().
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(
    session({
      store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
      secret: config.get<string>('SESSION_SECRET') ?? '',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.get<string>('NODE_ENV') === 'production',
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

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.useStaticAssets(join(__dirname, '..', 'node_modules', 'htmx.org', 'dist'), { prefix: '/vendor/htmx' });
  app.useStaticAssets(join(__dirname, '..', 'node_modules', 'alpinejs', 'dist'), { prefix: '/vendor/alpine' });
  configureViews(expressApp);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LocalsInterceptor(), new HtmxRenderInterceptor());
}
