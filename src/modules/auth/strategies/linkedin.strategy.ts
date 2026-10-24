import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, Profile, VerifyCallback } from 'passport-openidconnect';
import { AuthService } from '../auth.service';

@Injectable()
export class LinkedinStrategy extends PassportStrategy(Strategy, 'linkedin') {
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

  async validate(_issuer: string, profile: Profile, done: VerifyCallback) {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('LinkedIn profile did not include an email address'));
      return;
    }
    const user = await this.authService.findOrCreateOAuthUser(
      'linkedin',
      profile.id,
      email,
      profile.displayName,
      profile.photos?.[0]?.value,
    );
    done(null, user);
  }
}
