import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import { NextFunction, Request, Response } from 'express';

const DASHBOARD_PATH = '/admin/queues';
const QUEUE_NAMES = [
  'ping',
  'parse-resume',
  'embed-profile',
  'crawl-source',
  'upsert-jobs',
  'dedupe',
  'enrich-job',
  'maintenance',
] as const;

export function configureBullBoard(app: NestExpressApplication): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(DASHBOARD_PATH);

  const queues = QUEUE_NAMES.flatMap((name) => {
    const queue = app.get<Queue>(getQueueToken(name), { strict: false });
    return queue ? [new BullMQAdapter(queue, { readOnlyMode: true })] : [];
  });
  createBullBoard({ queues, serverAdapter });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(DASHBOARD_PATH, requireAdmin, serverAdapter.getRouter());
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = req.user as { role?: string } | undefined;
  if (!req.isAuthenticated() || !user) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  if (user.role !== 'admin') {
    res.sendStatus(403);
    return;
  }
  next();
}
