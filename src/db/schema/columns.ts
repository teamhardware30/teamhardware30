import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidV7 } from '../../common/db/uuid-v7';

/** App inserts use UUIDv7 directly; raw SQL inserts use the matching DB function. */
export function idColumn() {
  return uuid('id')
    .primaryKey()
    .default(sql`public.uuid_v7()`)
    .$defaultFn(() => uuidV7());
}

export function createdAtColumn() {
  return timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
}

export function updatedAtColumn() {
  return timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
}
