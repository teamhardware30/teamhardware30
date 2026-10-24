import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.isAuthenticated?.()) {
      return true;
    }
    const res = context.switchToHttp().getResponse<Response>();
    const next = encodeURIComponent(req.originalUrl);
    res.redirect(`/login?next=${next}`);
    return false;
  }
}
