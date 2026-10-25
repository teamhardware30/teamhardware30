import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile } from 'passport-google-oauth20';
import { Strategy } from 'passport-google-oauth20';
import { User } from '../../../db/schema';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService, private readonly authService: AuthService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') ?? '',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? '',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL') ?? '',
      scope: ['email', 'profile'],
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile): Promise<User> {
    const verifiedEntry = profile.emails?.find((entry) => entry.verified === true);
    const verifiedClaim =
      profile._json?.email_verified === true && typeof profile._json.email === 'string'
        ? profile._json.email
        : undefined;
    const email = verifiedEntry?.value ?? verifiedClaim ?? profile.emails?.[0]?.value ?? profile._json?.email;

    return this.authService.findOrCreateOAuthUser(
      'google',
      profile.id,
      email,
      profile.displayName,
      profile.photos?.[0]?.value,
      verifiedEntry !== undefined || verifiedClaim !== undefined,
    );
  }
}
