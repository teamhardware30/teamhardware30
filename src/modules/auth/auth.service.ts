import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import { MailService } from '../../common/mail/mail.service';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { OauthProvider, User } from '../../db/schema';
import { accounts } from '../../db/schema';
import { UsersService } from '../users/users.service';
import { hashPassword, verifyPassword } from './password.util';

const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;

export class OAuthEmailUnavailableError extends Error {
  readonly code = 'oauth_email_unavailable';

  constructor(provider: OauthProvider) {
    super(`${provider} profile did not include a verified email address`);
    this.name = OAuthEmailUnavailableError.name;
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(email: string, password: string, name?: string): Promise<User> {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const emailVerificationToken = randomBytes(32).toString('hex');
    const user = await this.usersService.create({
      email,
      name,
      passwordHash,
      emailVerificationToken,
      emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    });

    await this.sendVerificationEmail(user.email, emailVerificationToken);
    return user;
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verifyUrl = `${this.config.get<string>('APP_URL')}/verify-email?token=${token}`;
    await this.mailService.sendVerificationEmail(email, verifyUrl);
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.emailVerifiedAt) {
      return;
    }

    const emailVerificationToken = randomBytes(32).toString('hex');
    await this.usersService.update(user.id, {
      emailVerificationToken,
      emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    });
    await this.sendVerificationEmail(user.email, emailVerificationToken);
  }

  async verifyEmail(token: string): Promise<User> {
    const user = await this.usersService.findByVerificationToken(token);
    if (!user) {
      throw new BadRequestException('This verification link is invalid or has expired');
    }
    return this.usersService.markEmailVerified(user.id);
  }

  async validateLocal(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email address before signing in');
    }
    return user;
  }

  async findOrCreateOAuthUser(
    provider: OauthProvider,
    providerAccountId: string,
    email: string | undefined,
    name?: string,
    avatarUrl?: string,
    emailVerified = false,
  ): Promise<User> {
    const existingAccount = await this.db.query.accounts.findFirst({
      where: and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)),
    });
    if (existingAccount) {
      const user = await this.usersService.findById(existingAccount.userId);
      if (user) {
        return user;
      }
    }

    const verifiedEmail = email?.trim();
    if (!verifiedEmail || !emailVerified) {
      throw new OAuthEmailUnavailableError(provider);
    }

    const existingUser = await this.usersService.findByEmail(verifiedEmail);
    if (existingUser) {
      await this.db.insert(accounts).values({ userId: existingUser.id, provider, providerAccountId });
      const updates: Parameters<UsersService['update']>[1] = {};
      if (!existingUser.emailVerifiedAt) {
        updates.emailVerifiedAt = new Date();
        updates.emailVerificationToken = null;
        updates.emailVerificationExpiresAt = null;
      }
      if (!existingUser.name && name) {
        updates.name = name;
      }
      if (!existingUser.avatarUrl && avatarUrl) {
        updates.avatarUrl = avatarUrl;
      }
      return Object.keys(updates).length > 0 ? this.usersService.update(existingUser.id, updates) : existingUser;
    }

    const user = await this.usersService.create({
      email: verifiedEmail,
      name,
      avatarUrl,
      emailVerifiedAt: new Date(),
    });
    await this.db.insert(accounts).values({ userId: user.id, provider, providerAccountId });
    return user;
  }
}
