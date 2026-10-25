import { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function makeRequest(): Request {
  return { headers: {}, session: { flash: [] } } as unknown as Request;
}

function makeResponse(): Response {
  return { redirect: vi.fn(), setHeader: vi.fn(), sendStatus: vi.fn() } as unknown as Response;
}

describe('AuthController resendVerification', () => {
  it('returns the same redirect and flash for deliverable and invalid emails', async () => {
    const authService = { resendVerificationEmail: vi.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(authService as unknown as AuthService);
    const knownReq = makeRequest();
    const invalidReq = makeRequest();
    const knownRes = makeResponse();
    const invalidRes = makeResponse();

    await controller.resendVerification({ email: 'ada@example.com' }, knownReq, knownRes);
    await controller.resendVerification({ email: 'not-an-email' }, invalidReq, invalidRes);

    expect(authService.resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(authService.resendVerificationEmail).toHaveBeenCalledWith('ada@example.com');
    expect(knownRes.redirect).toHaveBeenCalledWith('/login');
    expect(invalidRes.redirect).toHaveBeenCalledWith('/login');
    expect(knownReq.session?.flash).toEqual(invalidReq.session?.flash);
    expect(knownReq.session?.flash).toHaveLength(1);
  });

  it('is rate limited independently of login and registration', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController.prototype.resendVerification)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', AuthController.prototype.resendVerification)).toBe(60_000);
  });
});
