import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile } from 'passport-openidconnect';
import { Strategy } from 'passport-openidconnect';
import { User } from '../../../db/schema';
import { AuthService } from '../auth.service';

@Injectable()
export class LinkedinStrategy extends PassportStrategy(Strategy, 'linkedin', 9) {
  // The nine-argument callback exposes userinfo._json; passport-openidconnect drops it from its merged profile.
  constructor(config: ConfigService, private readonly authService: AuthService) {
    super({
      issuer: 'https://www.linkedin.com/oauth',
      authorizationURL: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenURL: 'https://www.linkedin.com/oauth/v2/accessToken',
      userInfoURL: 'https://api.linkedin.com/v2/userinfo',
      clientID: config.get<string>('LINKEDIN_CLIENT_ID') ?? '',
      clientSecret: config.get<string>('LINKEDIN_CLIENT_SECRET') ?? '',
      callbackURL: config.get<string>('LINKEDIN_CALLBACK_URL') ?? '',
      scope: ['openid', 'profile', 'email'],
    });
  }

  async validate(
    _issuer: string,
    profile: Profile,
    _idProfile: object,
    _context: object,
    _idToken: string | object,
    _accessToken: string | object,
    _refreshToken: string,
    _params: unknown,
  ): Promise<User> {
    const claims: unknown = (profile as { _json?: unknown })._json;
    const claimEmailValue = readClaim(claims, 'email');
    const claimEmail = typeof claimEmailValue === 'string' ? claimEmailValue : undefined;
    const verifiedClaim = readClaim(claims, 'email_verified') === true && claimEmail ? claimEmail : undefined;
    const email = verifiedClaim ?? profile.emails?.[0]?.value ?? claimEmail;
    const pictureClaim = readClaim(claims, 'picture');
    const avatarUrl = typeof pictureClaim === 'string' ? pictureClaim : profile.photos?.[0]?.value;

    return this.authService.findOrCreateOAuthUser(
      'linkedin',
      profile.id,
      email,
      profile.displayName,
      avatarUrl,
      verifiedClaim !== undefined,
    );
  }
}

function readClaim(claims: unknown, key: 'email' | 'email_verified' | 'picture'): unknown {
  if (typeof claims !== 'object' || claims === null) {
    return undefined;
  }
  return (claims as Record<string, unknown>)[key];
}
