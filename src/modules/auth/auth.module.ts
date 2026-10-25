import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../../common/mail/mail.module';
import { RedisThrottlerStorage } from '../../common/throttler/redis-throttler.storage';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthGuard, LinkedinOAuthGuard } from './guards/oauth.guard';
import { GoogleStrategy } from './strategies/google.strategy';
import { LinkedinStrategy } from './strategies/linkedin.strategy';
import { LocalStrategy } from './strategies/local.strategy';

@Module({
  imports: [
    UsersModule,
    MailModule,
    PassportModule.register({ session: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 10 }],
        storage: new RedisThrottlerStorage(config),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    GoogleOAuthGuard,
    LinkedinOAuthGuard,
    {
      provide: LinkedinStrategy,
      inject: [ConfigService, AuthService],
      useFactory: (config: ConfigService, authService: AuthService) =>
        config.get<string>('LINKEDIN_CLIENT_ID') ? new LinkedinStrategy(config, authService) : undefined,
    },
    {
      provide: GoogleStrategy,
      inject: [ConfigService, AuthService],
      useFactory: (config: ConfigService, authService: AuthService) =>
        config.get<string>('GOOGLE_CLIENT_ID') ? new GoogleStrategy(config, authService) : undefined,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
