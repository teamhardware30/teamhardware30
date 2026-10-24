import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { accounts, OauthProvider, User } from '../../db/schema';
import { UsersService } from '../users/users.service';
import { MailService } from '../../common/mail/mail.service';
import { hashPassword, verifyPassword } from './password.util';

const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;

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
    email: string,
    name?: string,
    avatarUrl?: string,
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

    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      await this.db.insert(accounts).values({ userId: existingUser.id, provider, providerAccountId });
      if (!existingUser.emailVerifiedAt) {
        return this.usersService.markEmailVerified(existingUser.id);
      }
      return existingUser;
    }

    const user = await this.usersService.create({
      email,
      name,
      avatarUrl,
      emailVerifiedAt: new Date(),
    });
    await this.db.insert(accounts).values({ userId: user.id, provider, providerAccountId });
    return user;
  }
}
