import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Calls Voyage AI's embeddings endpoint (Anthropic's recommended embedding
 * partner — Anthropic does not host an embeddings API of its own).
 * `voyage-2` returns 1024-dim vectors, matching the seeker_profiles/jobs
 * `embedding` column.
 */
class VoyageEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(VoyageEmbeddingProvider.name);

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('EMBEDDING_API_KEY is not set — cannot call the Voyage embeddings API');
    }
    if (texts.length === 0) {
      return [];
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Voyage embeddings request failed (${response.status}): ${body}`);
      throw new Error(`Embedding request failed with status ${response.status}`);
    }

    const json = (await response.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}

class NoopEmbeddingProvider implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

@Injectable()
export class EmbeddingProviderFactory {
  create(config: ConfigService): EmbeddingProvider {
    const provider = config.get<string>('EMBEDDING_PROVIDER');
    if (provider === 'voyage') {
      return new VoyageEmbeddingProvider(
        config.get<string>('EMBEDDING_API_KEY'),
        config.get<string>('EMBEDDING_MODEL') ?? 'voyage-2',
      );
    }
    return new NoopEmbeddingProvider();
  }
}
