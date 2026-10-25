import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { RedirectException } from '../../../common/exceptions/redirect.exception';
import { User } from '../../../db/schema';
import { GoogleOAuthGuard, LinkedinOAuthGuard } from './oauth.guard';

function contextFor(req: Request): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function makeRequest(query: Record<string, unknown> = {}): Request {
  return { query, session: { flash: [] } } as unknown as Request;
}

describe('OAuth guards', () => {
  it('returns a successfully authenticated user', () => {
    const req = makeRequest();
    const user = { id: '11111111-1111-4111-8111-111111111111' } as User;

    expect(new GoogleOAuthGuard().handleRequest(null, user, undefined, contextFor(req))).toBe(user);
    expect(req.session?.flash).toEqual([]);
  });

  it('redirects with a friendly missing-verified-email flash', () => {
    const req = makeRequest();
    const guard = new GoogleOAuthGuard();
    const activate = () =>
      guard.handleRequest<User | undefined>({ code: 'oauth_email_unavailable' }, undefined, undefined, contextFor(req));

    let thrown: unknown;
    try {
      activate();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RedirectException);
    expect(thrown).toMatchObject({ location: '/login' });
    expect(req.session?.flash).toEqual([
      expect.objectContaining({ type: 'error', message: expect.stringContaining('verified email address') }),
    ]);
  });

  it('handles provider consent denial before invoking Passport', async () => {
    const req = makeRequest({ error: 'access_denied' });

    await expect(new LinkedinOAuthGuard().canActivate(contextFor(req))).rejects.toMatchObject({ location: '/login' });
    expect(req.session?.flash).toEqual([
      expect.objectContaining({ type: 'error', message: expect.stringContaining('cancelled') }),
    ]);
  });
});
