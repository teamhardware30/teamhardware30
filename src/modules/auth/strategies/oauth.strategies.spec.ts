import { ConfigService } from '@nestjs/config';
import { Profile as GoogleProfile } from 'passport-google-oauth20';
import { Profile as LinkedinProfile } from 'passport-openidconnect';
import { describe, expect, it, vi } from 'vitest';
import { User } from '../../../db/schema';
import { AuthService} from '../auth.service';
import { OAuthEmailUnavailableError } from '../auth.service';
import { GoogleStrategy } from './google.strategy';
import { LinkedinStrategy } from './linkedin.strategy';

function makeDependencies() {
  const authService = { findOrCreateOAuthUser: vi.fn() };
  const config = new ConfigService({
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    LINKEDIN_CLIENT_ID: 'linkedin-client',
    LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
    LINKEDIN_CALLBACK_URL: 'http://localhost:3000/auth/linkedin/callback',
  });
  return { authService, config };
}

const user = { id: '11111111-1111-4111-8111-111111111111' } as User;

function validateLinkedin(strategy: LinkedinStrategy, profile: LinkedinProfile) {
  return strategy.validate('https://www.linkedin.com/oauth', profile, {}, {}, '', '', '', {});
}

describe('GoogleStrategy', () => {
  it('passes only a provider-verified email to account linking', async () => {
    const { authService, config } = makeDependencies();
    authService.findOrCreateOAuthUser.mockResolvedValue(user);
    const strategy = new GoogleStrategy(config, authService as unknown as AuthService);
    const profile = {
      id: 'google-sub',
      provider: 'google',
      displayName: 'Ada Lovelace',
      emails: [{ value: 'ada@example.com', verified: true }],
      photos: [{ value: 'https://cdn.example.com/ada.jpg' }],
      _json: { email: 'ada@example.com', email_verified: true },
    } as GoogleProfile;

    await expect(strategy.validate('access-token', 'refresh-token', profile)).resolves.toBe(user);

    expect(authService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'google',
      'google-sub',
      'ada@example.com',
      'Ada Lovelace',
      'https://cdn.example.com/ada.jpg',
      true,
    );
  });

  it('fails cleanly instead of linking an unverified email', async () => {
    const { authService, config } = makeDependencies();
    authService.findOrCreateOAuthUser.mockRejectedValue(new OAuthEmailUnavailableError('google'));
    const strategy = new GoogleStrategy(config, authService as unknown as AuthService);
    const profile = {
      id: 'google-sub',
      provider: 'google',
      emails: [{ value: 'ada@example.com', verified: false }],
      _json: { email: 'ada@example.com', email_verified: false },
    } as GoogleProfile;

    await expect(strategy.validate('access-token', 'refresh-token', profile)).rejects.toMatchObject({
      code: 'oauth_email_unavailable',
    });

    expect(authService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'google',
      'google-sub',
      'ada@example.com',
      undefined,
      undefined,
      false,
    );
  });
});

describe('LinkedinStrategy', () => {
  it('uses the verified OIDC email claim', async () => {
    const { authService, config } = makeDependencies();
    authService.findOrCreateOAuthUser.mockResolvedValue(user);
    const strategy = new LinkedinStrategy(config, authService as unknown as AuthService);
    const profile = {
      id: 'linkedin-sub',
      provider: 'linkedin',
      displayName: 'Ada Lovelace',
      emails: [{ value: 'ada@example.com' }],
      _json: { email: 'ada@example.com', email_verified: true, picture: 'https://cdn.example.com/ada.jpg' },
    } as unknown as LinkedinProfile;

    await expect(validateLinkedin(strategy, profile)).resolves.toBe(user);

    expect(authService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'linkedin',
      'linkedin-sub',
      'ada@example.com',
      'Ada Lovelace',
      'https://cdn.example.com/ada.jpg',
      true,
    );
  });

  it('fails cleanly when the OIDC email is unverified', async () => {
    const { authService, config } = makeDependencies();
    authService.findOrCreateOAuthUser.mockRejectedValue(new OAuthEmailUnavailableError('linkedin'));
    const strategy = new LinkedinStrategy(config, authService as unknown as AuthService);
    const profile = {
      id: 'linkedin-sub',
      provider: 'linkedin',
      emails: [{ value: 'ada@example.com' }],
      _json: { email: 'ada@example.com', email_verified: false },
    } as unknown as LinkedinProfile;
    await expect(validateLinkedin(strategy, profile)).rejects.toMatchObject({ code: 'oauth_email_unavailable' });

    expect(authService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'linkedin',
      'linkedin-sub',
      'ada@example.com',
      undefined,
      undefined,
      false,
    );
  });

  it('handles a missing email without throwing an internal error', async () => {
    const { authService, config } = makeDependencies();
    authService.findOrCreateOAuthUser.mockRejectedValue(new OAuthEmailUnavailableError('linkedin'));
    const strategy = new LinkedinStrategy(config, authService as unknown as AuthService);
    const profile = { id: 'linkedin-sub', provider: 'linkedin', _json: {} } as unknown as LinkedinProfile;
    await expect(validateLinkedin(strategy, profile)).rejects.toMatchObject({ code: 'oauth_email_unavailable' });

    expect(authService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      'linkedin',
      'linkedin-sub',
      undefined,
      undefined,
      undefined,
      false,
    );
  });
});
