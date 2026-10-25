import 'reflect-metadata';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  process.env.WORKER = 'true';
  const { NestFactory } = await import('@nestjs/core');
  const { Logger } = await import('@nestjs/common');
  const { AppModule } = await import('./app.module');

  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, tracesSampleRate: 0.1 });
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('Worker started — listening for BullMQ jobs', 'Worker');
}

bootstrap();
