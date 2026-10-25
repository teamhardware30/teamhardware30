import { CanActivate, ExecutionContext} from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { User } from '../../../db/schema';
import { AuthRole} from './roles.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as User | undefined;
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('You do not have access to this page');
    }
    return true;
  }
}
