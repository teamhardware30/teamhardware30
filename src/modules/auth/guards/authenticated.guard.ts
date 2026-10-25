import { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { RedirectException } from '../../../common/exceptions/redirect.exception';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.isAuthenticated?.()) {
      return true;
    }
    throw new RedirectException(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
}
