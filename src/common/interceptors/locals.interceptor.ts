import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { generateToken } from '../security/csrf';

declare module 'express-session' {
  interface SessionData {
    flash?: { type: 'success' | 'error' | 'info'; message: string }[];
  }
}

/**
 * Populates res.locals.user / csrfToken / flash for every server-rendered
 * page, so views never need to reach into req/session directly.
 */
@Injectable()
export class LocalsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    res.locals.user = req.user ?? null;
    res.locals.csrfToken = generateToken(req, res);
    res.locals.flash = req.session?.flash ?? [];
    res.locals.currentPath = req.path;
    res.locals.currentUrl = req.originalUrl;
    if (req.session) {
      req.session.flash = [];
    }

    return next.handle();
  }
}
