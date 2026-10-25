import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodType } from 'zod';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { NewAiCall } from '../../db/schema';
import { aiCalls } from '../../db/schema';
import { EmbeddingProviderResult } from './embedding-provider';
import { EmbeddingProviderFactory, EMBEDDING_DIMENSIONS } from './embedding-provider';
import { renderPrompt } from './prompt-renderer';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

type ModelResult = {
  text: string;
  response: unknown;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
};

type AiStatus = 'success' | 'retried' | 'failed';

@Injectable()
export class AiService {
  get embeddingModel(): string {
    return this.config.get<string>('EMBEDDING_MODEL') ?? 'voyage-2';
  }
  private readonly client: Anthropic;
  private readonly embeddingFactory: EmbeddingProviderFactory;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Optional() embeddingFactory?: EmbeddingProviderFactory,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
      maxRetries: 0,
    });
    this.embeddingFactory = embeddingFactory ?? new EmbeddingProviderFactory(config);
  }

  async completeJson<T>(promptName: string, vars: Record<string, unknown>, schema: ZodType<T>): Promise<T> {
    const renderedPrompt = renderPrompt(promptName, vars);
    const model = this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';
    let lastError: Error = new Error('AI request failed');

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      let initial: ModelResult;
      try {
        initial = await this.callModel(renderedPrompt, model);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('AI request failed');
        const retryable = this.isRetryable(error);
        await this.logCall({
          promptName,
          model,
          input: { stage: 'initial', prompt: renderedPrompt },
          output: null,
          status: retryable && attempt < 4 ? 'retried' : 'failed',
          success: false,
          attempt,
          tokensIn: null,
          tokensOut: null,
          durationMs: null,
          errorMessage: String(lastError),
        });
        if (!retryable || attempt === 4) throw lastError;
        await this.sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4_000);
        continue;
      }

      try {
        const parsed = schema.parse(JSON.parse(this.stripJsonFence(initial.text)));
        await this.logCall({
          promptName,
          model,
          input: { stage: 'initial', prompt: renderedPrompt },
          output: initial.response,
          status: 'success',
          success: true,
          attempt,
          tokensIn: initial.tokensIn,
          tokensOut: initial.tokensOut,
          durationMs: initial.durationMs,
        });
        return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Invalid AI response');
        await this.logCall({
          promptName,
          model,
          input: { stage: 'initial', prompt: renderedPrompt },
          output: initial.response,
          status: 'retried',
          success: false,
          attempt,
          tokensIn: initial.tokensIn,
          tokensOut: initial.tokensOut,
          durationMs: initial.durationMs,
          errorMessage: String(lastError),
        });

        const repairPrompt = `${renderedPrompt}\n\n<invalid_response>\n${initial.text}\n</invalid_response>\nReturn only valid JSON matching the requested schema.`;
        let repair: ModelResult;
        try {
          repair = await this.callModel(repairPrompt, model);
        } catch (repairError) {
          await this.logCall({
            promptName,
            model,
            input: { stage: 'repair', prompt: repairPrompt },
            output: null,
            status: 'failed',
            success: false,
            attempt,
            tokensIn: null,
            tokensOut: null,
            durationMs: null,
            errorMessage: repairError instanceof Error ? String(repairError) : 'AI request failed',
          });
          if (this.isRetryable(repairError) && attempt < 4) {
            await this.sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4_000);
            continue;
          }
          throw repairError instanceof Error ? repairError : new Error('AI request failed');
        }

        try {
          const repaired = schema.parse(JSON.parse(this.stripJsonFence(repair.text)));
          await this.logCall({
            promptName,
            model,
            input: { stage: 'repair', prompt: repairPrompt },
            output: repair.response,
            status: 'success',
            success: true,
            attempt,
            tokensIn: repair.tokensIn,
            tokensOut: repair.tokensOut,
            durationMs: repair.durationMs,
          });
          return repaired;
        } catch (repairError) {
          lastError = repairError instanceof Error ? repairError : new Error('Invalid AI response after one repair');
          await this.logCall({
            promptName,
            model,
            input: { stage: 'repair', prompt: repairPrompt },
            output: repair.response,
            status: 'failed',
            success: false,
            attempt,
            tokensIn: repair.tokensIn,
            tokensOut: repair.tokensOut,
            durationMs: repair.durationMs,
            errorMessage: String(lastError),
          });
          throw new Error(`${lastError.message} after one repair`);
        }
      }
    }

    throw lastError;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const dimensions = this.config.get<number>('EMBEDDING_DIMENSIONS') ?? EMBEDDING_DIMENSIONS;
    const provider = this.embeddingFactory.create(this.config);
    const model = provider.model;
    let lastError: Error = new Error('Embedding request failed');

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const startedAt = Date.now();
      let rawResponse: unknown = null;
      try {
        const result: EmbeddingProviderResult = await provider.embed(texts);
        rawResponse = result.rawResponse;
        if (result.embeddings.length !== texts.length) {
          throw Object.assign(new Error(`Embedding provider returned ${result.embeddings.length} vectors for ${texts.length} inputs`), { rawResponse });
        }
        for (const vector of result.embeddings) {
          if (vector.length !== dimensions) {
            throw Object.assign(new Error(`Embedding provider returned a vector with ${vector.length} dimensions, not ${dimensions} dimensions`), { rawResponse });
          }
        }
        await this.logCall({
          promptName: 'embed',
          model,
          input: { stage: 'initial', prompt: JSON.stringify(texts) },
          output: result.rawResponse,
          status: 'success',
          success: true,
          attempt,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          durationMs: Date.now() - startedAt,
        });
        return result.embeddings;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Embedding request failed');
        const retryable = this.isRetryable(error);
        await this.logCall({
          promptName: 'embed',
          model,
          input: { stage: 'initial', prompt: JSON.stringify(texts) },
          output: (error as { rawResponse?: unknown }).rawResponse ?? rawResponse,
          status: retryable && attempt < 4 ? 'retried' : 'failed',
          success: false,
          attempt,
          tokensIn: null,
          tokensOut: null,
          durationMs: Date.now() - startedAt,
          errorMessage: String(lastError),
        });
        if (!retryable || attempt === 4) {
          if (lastError.message.toLowerCase().includes('abort') || lastError.message.toLowerCase().includes('timeout')) {
            throw new Error('Embedding request failed or timed out');
          }
          throw lastError;
        }
        await this.sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4_000);
      }
    }

    throw lastError;
  }

  private async callModel(prompt: string, model: string): Promise<ModelResult> {
    const startedAt = Date.now();
    const response = await this.client.messages.create({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }, { timeout: 60_000 });
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    return {
      text,
      response,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      durationMs: Date.now() - startedAt,
    };
  }

  private isRetryable(error: unknown): boolean {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status === 429 || (status >= 500 && status < 600);
    }
    return false;
  }

  private async logCall(input: {
    promptName: string;
    model: string;
    input: unknown;
    output: unknown;
    status: AiStatus;
    success: boolean;
    attempt: number;
    tokensIn: number | null;
    tokensOut: number | null;
    durationMs: number | null;
    errorMessage?: string;
  }): Promise<void> {
    const isEmbedding = input.promptName === 'embed';
    const costPerInput = Number(
      this.config.get<string>(isEmbedding ? 'EMBEDDING_COST_PER_MILLION' : 'ANTHROPIC_INPUT_COST_PER_MILLION') ?? 0,
    );
    const costPerOutput = isEmbedding ? 0 : Number(this.config.get<string>('ANTHROPIC_OUTPUT_COST_PER_MILLION') ?? 0);
    const cost =
      input.tokensIn === null || input.tokensOut === null
        ? null
        : ((input.tokensIn / 1_000_000) * costPerInput + (input.tokensOut / 1_000_000) * costPerOutput).toFixed(6);

    const row: NewAiCall = {
      purpose: input.promptName,
      promptName: input.promptName,
      model: input.model,
      rawInput: input.input,
      rawOutput: input.output,
      status: input.status,
      success: input.success,
      attempt: input.attempt,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: cost,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs,
    };
    await this.db.insert(aiCalls).values(row);
  }

  private stripJsonFence(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
