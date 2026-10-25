import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/modules/ai/ai.service';
import {
  EmbeddingProvider,
  EmbeddingProviderResult} from '../src/modules/ai/embedding-provider';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingProviderFactory
} from '../src/modules/ai/embedding-provider';

function vector(value: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
}

function result(embeddings: number[][], inputTokens = 20): EmbeddingProviderResult {
  return {
    embeddings,
    rawResponse: { data: embeddings.map((embedding, index) => ({ embedding, index })), usage: { total_tokens: inputTokens } },
    usage: { inputTokens, outputTokens: 0 },
  };
}

function makeService(
  factory: EmbeddingProviderFactory | { create: () => EmbeddingProvider },
  configOverrides: Record<string, string> = {},
) {
  const logs: Record<string, unknown>[] = [];
  const values = vi.fn((value: Record<string, unknown>) => {
    logs.push(value);
    return Promise.resolve();
  });
  const db = { insert: vi.fn(() => ({ values })) };
  const configValues: Record<string, string> = {
    ANTHROPIC_API_KEY: 'test-key',
    ...configOverrides,
  };
  const config = { get: vi.fn((key: string) => configValues[key]) };
  const service = new AiService(config as never, db as never, factory as never);
  return { service, logs };
}

function fakeProvider() {
  const provider: EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } = {
    name: 'fake',
    model: 'fake-1024',
    disabled: false,
    embed: vi.fn(),
  };
  return provider;
}

describe('AiService.embed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns and logs 64 validated 1024-dimension vectors without a real provider', async () => {
    const provider = fakeProvider();
    const embeddings = Array.from({ length: 64 }, (_, index) => vector(index / 1000));
    provider.embed.mockResolvedValueOnce(result(embeddings, 640));
    const { service, logs } = makeService(
      { create: () => provider },
      { EMBEDDING_COST_PER_MILLION: '0.5' },
    );

    const output = await service.embed(Array.from({ length: 64 }, (_, index) => `profile ${index}`));
    expect(output).toHaveLength(64);
    expect(output.every((embedding) => embedding.length === 1024)).toBe(true);
    expect(provider.embed).toHaveBeenCalledOnce();
    expect(logs[0]).toMatchObject({
      promptName: 'embed',
      model: 'fake-1024',
      success: true,
      tokensIn: 640,
      tokensOut: 0,
      costUsd: '0.000320',
    });
    expect(logs[0].rawInput).toBeTruthy();
    expect(logs[0].rawOutput).toBeTruthy();
  });

  it('rejects count mismatches and wrong dimensions without retrying or hiding the bad output', async () => {
    const provider = fakeProvider();
    provider.embed.mockResolvedValueOnce(result([vector(0.1)]));
    const { service, logs } = makeService({ create: () => provider });
    await expect(service.embed(['one', 'two'])).rejects.toThrow('1 vectors for 2 inputs');

    provider.embed.mockResolvedValueOnce(result([[0.1, 0.2]]));
    await expect(service.embed(['one'])).rejects.toThrow('not 1024 dimensions');
    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(logs.map((log) => log.success)).toEqual([false, false]);
    expect(logs[1].rawOutput).toBeTruthy();
  });

  it('retries retryable embedding provider failures and logs each attempt', async () => {
    vi.useFakeTimers();
    const provider = fakeProvider();
    provider.embed
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValueOnce(result([vector(0.5)]));
    const { service, logs } = makeService({ create: () => provider });

    const pending = service.embed(['profile']);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual([vector(0.5)]);
    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(logs.map((log) => log.status)).toEqual(['retried', 'success']);
  });

  it('configures a 60-second Voyage timeout and does not retry timeout failures', async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchMock = vi.fn().mockRejectedValue(new Error('aborted'));
    vi.stubGlobal('fetch', fetchMock);
    const { service, logs } = makeService(new EmbeddingProviderFactory(), {
      EMBEDDING_PROVIDER: 'voyage',
      EMBEDDING_API_KEY: 'voyage-test',
      EMBEDDING_MODEL: 'voyage-2',
    });

    await expect(service.embed(['profile'])).rejects.toThrow('failed or timed out');
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logs[0]).toMatchObject({ success: false, status: 'failed', model: 'voyage-2' });
  });

  it('retries a Voyage 500 response and restores provider index ordering', async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const first = vector(0.1);
    const second = vector(0.2);
    const reversed = new Response(
      JSON.stringify({
        data: [
          { embedding: second, index: 1 },
          { embedding: first, index: 0 },
        ],
        usage: { total_tokens: 12 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 500 }))
      .mockResolvedValueOnce(reversed);
    vi.stubGlobal('fetch', fetchMock);
    const { service, logs } = makeService(new EmbeddingProviderFactory(), {
      EMBEDDING_PROVIDER: 'voyage',
      EMBEDDING_API_KEY: 'voyage-test',
      EMBEDDING_MODEL: 'voyage-2',
    });

    const pending = service.embed(['first', 'second']);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(logs.map((log) => log.status)).toEqual(['retried', 'success']);
    expect(logs[0].rawOutput).toEqual({ body: 'busy' });
    expect(logs[1].tokensIn).toBe(12);
  });
});
