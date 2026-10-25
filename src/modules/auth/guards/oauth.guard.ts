import { ExecutionContext} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { RedirectException } from '../../../common/exceptions/redirect.exception';
import { User } from '../../../db/schema';
import { pushFlash } from '../auth.utils';

const OAUTH_EMAIL_UNAVAILABLE = 'oauth_email_unavailable';

type ProviderName = 'Google' | 'LinkedIn';

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    return activateOAuth(context, () => super.canActivate(context) as Promise<boolean>, 'Google');
  }

  handleRequest<TUser = User>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    return handleOAuthRequest(err, user, info, context, 'Google');
  }
}

@Injectable()
export class LinkedinOAuthGuard extends AuthGuard('linkedin') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    return activateOAuth(context, () => super.canActivate(context) as Promise<boolean>, 'LinkedIn');
  }

  handleRequest<TUser = User>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    return handleOAuthRequest(err, user, info, context, 'LinkedIn');
  }
}

async function activateOAuth(
  context: ExecutionContext,
  activate: () => Promise<boolean>,
  provider: ProviderName,
): Promise<boolean> {
  const req = context.switchToHttp().getRequest<Request>();
  if (typeof req.query.error === 'string') {
    redirectWithError(req, provider, false);
  }
  return activate();
}

function handleOAuthRequest<TUser>(
  err: unknown,
  user: TUser,
  info: unknown,
  context: ExecutionContext,
  provider: ProviderName,
): TUser {
  if (!err && user) {
    return user;
  }

  const req = context.switchToHttp().getRequest<Request>();
  const emailUnavailable = errorCode(err) === OAUTH_EMAIL_UNAVAILABLE || errorCode(info) === OAUTH_EMAIL_UNAVAILABLE;
  redirectWithError(req, provider, emailUnavailable);
}

function redirectWithError(req: Request, provider: ProviderName, emailUnavailable: boolean): never {
  const message = emailUnavailable
    ? `${provider} did not provide a verified email address. Verify your email with ${provider} or use another sign-in method.`
    : `${provider} sign-in was cancelled or could not be completed. Please try again.`;
  pushFlash(req, 'error', message);
  throw new RedirectException('/login');
}

function errorCode(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return undefined;
  }
  return (value as { code?: unknown }).code;
}
