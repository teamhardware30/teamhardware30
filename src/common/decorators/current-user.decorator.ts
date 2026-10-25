import { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../../db/schema';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User | undefined => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.user as User | undefined;
});
