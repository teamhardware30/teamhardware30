import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface EmbeddingProviderResult {
  embeddings: number[][];
  rawResponse: unknown;
  usage: EmbeddingProviderUsage;
}

export interface EmbeddingProvider {
  name: string;
  model: string;
  disabled: boolean;
  embed(texts: string[]): Promise<EmbeddingProviderResult>;
}

@Injectable()
export class EmbeddingProviderFactory {
  constructor(@Optional() private readonly config?: ConfigService) {}

  create(config?: ConfigService): EmbeddingProvider {
    const resolvedConfig = config ?? this.config;
    const provider = resolvedConfig?.get<string>('EMBEDDING_PROVIDER') ?? 'voyage';
    if (provider === 'none') {
      const dimensions = resolvedConfig?.get<number>('EMBEDDING_DIMENSIONS') ?? EMBEDDING_DIMENSIONS;
      return {
        name: 'none',
        model: 'none',
        disabled: true,
        async embed(texts: string[]): Promise<EmbeddingProviderResult> {
          return {
            embeddings: texts.map(() => Array.from({ length: dimensions }, () => 0)),
            rawResponse: null,
            usage: { inputTokens: null, outputTokens: null },
          };
        },
      };
    }

    const model = resolvedConfig?.get<string>('EMBEDDING_MODEL') ?? 'voyage-2';
    const apiKey = resolvedConfig?.get<string>('EMBEDDING_API_KEY');
    const dimensions = resolvedConfig?.get<number>('EMBEDDING_DIMENSIONS') ?? EMBEDDING_DIMENSIONS;
    return new VoyageEmbeddingProvider(model, apiKey, dimensions);
  }
}

class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly disabled = false;

  constructor(
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly dimensions: number,
  ) {}

  async embed(texts: string[]): Promise<EmbeddingProviderResult> {
    if (!this.apiKey) {
      throw new Error('EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=voyage');
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts, input_type: 'document' }),
      signal: AbortSignal.timeout(60_000),
    });

    const rawText = await response.text();
    let rawResponse: unknown = rawText;
    try {
      rawResponse = JSON.parse(rawText);
    } catch {
      // Keep the raw response body for logging if it is not JSON.
    }

    if (!response.ok) {
      throw Object.assign(new Error(`Embedding provider returned ${response.status}`), { status: response.status, rawResponse: { body: rawText } });
    }

    const payload = rawResponse as { data?: Array<{ embedding?: unknown; index?: number }>; usage?: { total_tokens?: number } };
    const vectors = [...(payload.data ?? [])].sort((left, right) => {
      const leftIndex = typeof left.index === 'number' ? left.index : 0;
      const rightIndex = typeof right.index === 'number' ? right.index : 0;
      return leftIndex - rightIndex;
    });
    if (vectors.length !== texts.length) {
      throw Object.assign(new Error(`Embedding provider returned ${vectors.length} vectors for ${texts.length} inputs`), { rawResponse });
    }

    const embeddings = vectors.map((item) => {
      if (!Array.isArray(item.embedding) || item.embedding.length !== this.dimensions) {
        throw Object.assign(new Error(`Embedding provider returned a vector with ${Array.isArray(item.embedding) ? item.embedding.length : 0} dimensions, not ${this.dimensions} dimensions`), { rawResponse });
      }
      return item.embedding.map((value) => Number(value));
    });

    return {
      embeddings,
      rawResponse,
      usage: {
        inputTokens: payload.usage?.total_tokens ?? null,
        outputTokens: 0,
      },
    };
  }
}
