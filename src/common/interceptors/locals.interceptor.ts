import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
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
    if (req.session) {
      req.session.flash = [];
    }

    return next.handle();
  }
}
