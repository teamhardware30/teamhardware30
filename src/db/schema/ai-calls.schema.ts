import { pgTable, uuid, text, timestamp, jsonb, integer, pgEnum, boolean, numeric } from 'drizzle-orm/pg-core';

export const aiCallStatusEnum = pgEnum('ai_call_status', ['success', 'retried', 'failed']);

export const aiCalls = pgTable('ai_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  purpose: text('purpose').notNull(),
  promptName: text('prompt_name'),
  model: text('model').notNull(),
  rawInput: jsonb('raw_input').notNull(),
  rawOutput: jsonb('raw_output'),
  status: aiCallStatusEnum('status').notNull(),
  success: boolean('success').notNull().default(false),
  attempt: integer('attempt').notNull().default(1),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AiCall = typeof aiCalls.$inferSelect;
export type NewAiCall = typeof aiCalls.$inferInsert;
