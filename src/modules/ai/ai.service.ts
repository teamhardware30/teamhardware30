import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { ZodType } from 'zod';
import { DRIZZLE, Database } from '../../db/db.provider';
import { aiCalls } from '../../db/schema';
import { renderPrompt } from './prompt-renderer';
import { EmbeddingProviderFactory, EmbeddingProvider } from './embedding-provider';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 60_000;
const BACKOFF_MS = [1_000, 3_000, 8_000];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: Database,
    embeddingProviderFactory: EmbeddingProviderFactory,
  ) {
    this.client = new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') });
    this.model = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';
    this.embeddingProvider = embeddingProviderFactory.create(config);
  }

  /**
   * Renders `src/modules/ai/prompts/<promptName>.md` with `vars`, calls
   * Claude, and validates the JSON reply against `schema`. Retries up to
   * three times with backoff on 429/5xx, and attempts one repair pass if
   * the reply doesn't parse. Every attempt is logged to the aiCalls table.
   */
  async completeJson<T>(promptName: string, vars: Record<string, string>, schema: ZodType<T, any, any>): Promise<T> {
    const prompt = renderPrompt(promptName, vars);
    const system =
      'You are a precise data-extraction engine. Reply with ONLY valid JSON matching the required schema — no markdown fences, no commentary.';

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const raw = await this.callModel(system, prompt);
        const parsed = this.parseJson(raw, schema);

        if (parsed.success) {
          await this.logCall(promptName, prompt, raw, 'success', attempt, startedAt);
          return parsed.data;
        }

        const repaired = await this.repair(system, prompt, raw, parsed.errorText);
        const repairedParsed = this.parseJson(repaired, schema);
        if (repairedParsed.success) {
          await this.logCall(promptName, prompt, repaired, 'retried', attempt, startedAt);
          return repairedParsed.data;
        }

        lastError = new Error(`Schema validation failed after repair: ${repairedParsed.errorText}`);
        await this.logCall(promptName, prompt, repaired, 'failed', attempt, startedAt, lastError);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof APIError && (error.status === 429 || (error.status ?? 0) >= 500);
        this.logger.warn(`AI call "${promptName}" attempt ${attempt} failed: ${String(error)}`);
        await this.logCall(promptName, prompt, null, 'failed', attempt, startedAt, error);
        if (!retryable) {
          throw error;
        }
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1]);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('AI call failed');
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.embeddingProvider.embed(texts);
  }

  private async callModel(system: string, prompt: string): Promise<string> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: TIMEOUT_MS },
    );
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  private async repair(system: string, prompt: string, badOutput: string, errorText: string) {
    return this.callModel(
      system,
      `${prompt}\n\nYour previous reply could not be parsed as valid JSON matching the required schema.\nPrevious reply:\n${badOutput}\n\nValidation error:\n${errorText}\n\nReply again with ONLY valid JSON matching the schema.`,
    );
  }

  private parseJson<T>(raw: string, schema: ZodType<T, any, any>): { success: true; data: T } | { success: false; errorText: string } {
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

  private async logCall(
    purpose: string,
    input: string,
    output: string | null,
    status: 'success' | 'retried' | 'failed',
    attempt: number,
    startedAt: number,
    error?: unknown,
  ) {
    await this.db.insert(aiCalls).values({
      purpose,
      model: this.model,
      rawInput: { prompt: input },
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
