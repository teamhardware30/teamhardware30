import { pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { users } from './users.schema';

export const oauthProviderEnum = pgEnum('oauth_provider', ['linkedin', 'google']);

export const accounts = pgTable(
  'accounts',
  {
    id: idColumn(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: oauthProviderEnum('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    providerAccountUnique: unique().on(table.provider, table.providerAccountId),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type OauthProvider = Account['provider'];
