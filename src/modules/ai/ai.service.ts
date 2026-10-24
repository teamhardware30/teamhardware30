import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ZodSchema } from 'zod';
import { DRIZZLE, Database } from '../../db/db.provider';
import { aiCalls } from '../../db/schema';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;
const BACKOFF_MS = [1_000, 3_000, 8_000];

export interface AiCompletionOptions<T> {
  purpose: string;
  model?: string;
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;

  constructor(
    config: ConfigService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {
    this.client = new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') });
  }

  /**
   * Single entry point for every LLM call in the app. Retries on
   * transient failures, validates the JSON reply against `schema`,
   * attempts one repair pass if validation fails, and records every
   * attempt (raw input/output included) to the aiCalls table.
   */
  async complete<T>(options: AiCompletionOptions<T>): Promise<T> {
    const model = options.model ?? 'claude-sonnet-4-5';
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const startedAt = Date.now();
      try {
        const raw = await this.callModel(model, options.system, options.prompt);
        const parsed = this.parseJson(raw, options.schema);

        if (parsed.success) {
          await this.logCall(options, model, options.prompt, raw, 'success', attempt, startedAt);
          return parsed.data;
        }

        const repaired = await this.repair(model, options.system, options.prompt, raw, parsed.errorText);
        const repairedParsed = this.parseJson(repaired, options.schema);
        if (repairedParsed.success) {
          await this.logCall(options, model, options.prompt, repaired, 'retried', attempt, startedAt);
          return repairedParsed.data;
        }

        lastError = new Error(`Schema validation failed after repair: ${repairedParsed.errorText}`);
      } catch (error) {
        lastError = error;
        this.logger.warn(`AI call "${options.purpose}" attempt ${attempt} failed: ${String(error)}`);
      }

      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt - 1]);
      }
    }

    await this.logCall(options, model, options.prompt, null, 'failed', MAX_RETRIES, Date.now(), lastError);
    throw lastError instanceof Error ? lastError : new Error('AI call failed');
  }

  private async callModel(model: string, system: string, prompt: string): Promise<string> {
    const response = await this.client.messages.create(
      {
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: TIMEOUT_MS },
    );
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  private async repair(model: string, system: string, prompt: string, badOutput: string, errorText: string) {
    return this.callModel(
      model,
      system,
      `${prompt}\n\nYour previous reply could not be parsed as valid JSON matching the required schema.\nPrevious reply:\n${badOutput}\n\nValidation error:\n${errorText}\n\nReply again with ONLY valid JSON matching the schema.`,
    );
  }

  private parseJson<T>(raw: string, schema: ZodSchema<T>): { success: true; data: T } | { success: false; errorText: string } {
    try {
      const json = JSON.parse(extractJson(raw));
      const result = schema.safeParse(json);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false, errorText: result.error.toString() };
    } catch (error) {
      return { success: false, errorText: String(error) };
    }
  }

  private async logCall<T>(
    options: AiCompletionOptions<T>,
    model: string,
    input: string,
    output: string | null,
    status: 'success' | 'retried' | 'failed',
    attempt: number,
    startedAt: number,
    error?: unknown,
  ) {
    await this.db.insert(aiCalls).values({
      purpose: options.purpose,
      model,
      rawInput: { system: options.system, prompt: input },
      rawOutput: output ? { text: output } : null,
      status,
      attempt,
      errorMessage: error ? String(error) : null,
      durationMs: Date.now() - startedAt,
    });
  }
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
