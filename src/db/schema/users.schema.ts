import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';

export const users = pgTable('users', {
  id: idColumn(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  emailVerificationToken: text('email_verification_token'),
  emailVerificationExpiresAt: timestamp('email_verification_expires_at', { withTimezone: true }),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('seeker'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
