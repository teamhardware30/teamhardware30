import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { MailService } from '../../common/mail/mail.service';
import { Database } from '../../db/db.provider';
import { User } from '../../db/schema';
import { UsersService } from '../users/users.service';
import { AuthService, OAuthEmailUnavailableError } from './auth.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    emailVerifiedAt: null,
    emailVerificationToken: 'old-token',
    emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    passwordHash: null,
    role: 'admin',
    name: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService() {
  const findAccount = vi.fn();
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  const db = { query: { accounts: { findFirst: findAccount } }, insert } as unknown as Database;
  const usersService = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findByVerificationToken: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    markEmailVerified: vi.fn(),
  };
  const mailService = { sendVerificationEmail: vi.fn().mockResolvedValue(undefined) };
  const config = { get: vi.fn().mockReturnValue('http://localhost:3000') };
  const service = new AuthService(
    db,
    usersService as unknown as UsersService,
    mailService as unknown as MailService,
    config as unknown as ConfigService,
  );

  return { service, findAccount, insert, values, usersService, mailService };
}

describe('AuthService OAuth account linking', () => {
  it('returns an already-linked account without requiring its email again', async () => {
    const { service, findAccount, usersService, insert } = makeService();
    const user = makeUser({ emailVerifiedAt: new Date() });
    findAccount.mockResolvedValue({ userId: user.id });
    usersService.findById.mockResolvedValue(user);

    await expect(service.findOrCreateOAuthUser('google', 'google-sub', undefined)).resolves.toBe(user);
    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('links a provider-verified email to the existing local user and prefills missing profile fields', async () => {
    const { service, usersService, values } = makeService();
    const user = makeUser();
    const linkedUser = makeUser({ emailVerifiedAt: new Date(), name: 'Ada Lovelace' });
    usersService.findByEmail.mockResolvedValue(user);
    usersService.update.mockResolvedValue(linkedUser);

    await expect(
      service.findOrCreateOAuthUser(
        'google',
        'google-sub',
        'ada@example.com',
        'Ada Lovelace',
        'https://cdn.example.com/ada.jpg',
        true,
      ),
    ).resolves.toBe(linkedUser);

    expect(values).toHaveBeenCalledWith({ userId: user.id, provider: 'google', providerAccountId: 'google-sub' });
    expect(usersService.update).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        emailVerifiedAt: expect.any(Date),
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        name: 'Ada Lovelace',
        avatarUrl: 'https://cdn.example.com/ada.jpg',
      }),
    );
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('refuses to link or create an account for an unverified provider email', async () => {
    const { service, usersService, insert } = makeService();

    await expect(
      service.findOrCreateOAuthUser('linkedin', 'linkedin-sub', 'ada@example.com', 'Ada', undefined, false),
    ).rejects.toBeInstanceOf(OAuthEmailUnavailableError);
    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses to create an account when the provider omits email', async () => {
    const { service, usersService, insert } = makeService();

    await expect(
      service.findOrCreateOAuthUser('google', 'google-sub', undefined, 'Ada', undefined, true),
    ).rejects.toBeInstanceOf(OAuthEmailUnavailableError);
    expect(usersService.create).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('creates one verified social user and links the provider identity', async () => {
    const { service, usersService, values } = makeService();
    const user = makeUser({ emailVerifiedAt: new Date(), name: 'Ada Lovelace' });
    usersService.create.mockResolvedValue(user);

    await expect(
      service.findOrCreateOAuthUser(
        'linkedin',
        'linkedin-sub',
        'ada@example.com',
        'Ada Lovelace',
        'https://cdn.example.com/ada.jpg',
        true,
      ),
    ).resolves.toBe(user);

    expect(usersService.create).toHaveBeenCalledWith({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://cdn.example.com/ada.jpg',
      emailVerifiedAt: expect.any(Date),
    });
    expect(values).toHaveBeenCalledWith({ userId: user.id, provider: 'linkedin', providerAccountId: 'linkedin-sub' });
  });
});

describe('AuthService resendVerificationEmail', () => {
  it('does nothing for unknown or already-verified emails', async () => {
    const { service, usersService, mailService } = makeService();
    usersService.findByEmail
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(makeUser({ emailVerifiedAt: new Date() }));

    await service.resendVerificationEmail('unknown@example.com');
    await service.resendVerificationEmail('ada@example.com');

    expect(usersService.update).not.toHaveBeenCalled();
    expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('rotates the token and sends a fresh link for an unverified account', async () => {
    const { service, usersService, mailService } = makeService();
    const user = makeUser();
    usersService.findByEmail.mockResolvedValue(user);
    usersService.update.mockResolvedValue(user);

    await service.resendVerificationEmail(user.email);

    expect(usersService.update).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        emailVerificationToken: expect.any(String),
        emailVerificationExpiresAt: expect.any(Date),
      }),
    );
    const updates = usersService.update.mock.calls[0][1] as {
      emailVerificationToken: string;
      emailVerificationExpiresAt: Date;
    };
    expect(updates.emailVerificationToken).toHaveLength(64);
    expect(updates.emailVerificationToken).not.toBe('old-token');
    expect(updates.emailVerificationExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
      user.email,
      `http://localhost:3000/verify-email?token=${updates.emailVerificationToken}`,
    );
  });
});
