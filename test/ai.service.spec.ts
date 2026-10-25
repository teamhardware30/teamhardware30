import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiService } from '../src/modules/ai/ai.service';
import { EmbeddingProviderResult } from '../src/modules/ai/embedding-provider';

const sdk = vi.hoisted(() => ({ create: vi.fn(), constructorOptions: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicMock {
    messages = { create: sdk.create };
    constructor(options: unknown) {
      sdk.constructorOptions(options);
    }
  }
  return { default: AnthropicMock };
});

const schema = z.object({ answer: z.string() });

function completion(text: string, inputTokens = 100, outputTokens = 10) {
  return {
    model: 'claude-test',
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function makeService(configOverrides: Record<string, string> = {}) {
  const logs: Record<string, unknown>[] = [];
  const values = vi.fn((value: Record<string, unknown>) => {
    logs.push(value);
    return Promise.resolve();
  });
  const db = { insert: vi.fn(() => ({ values })) };
  const configValues: Record<string, string> = {
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_MODEL: 'claude-test',
    ...configOverrides,
  };
  const config = { get: vi.fn((key: string) => configValues[key]) };
  const embeddingProvider = {
    name: 'fake',
    model: 'fake-1024',
    disabled: false,
    embed: vi.fn(async (): Promise<EmbeddingProviderResult> => ({
      embeddings: [],
      rawResponse: null,
      usage: { inputTokens: null, outputTokens: null },
    })),
  };
  const factory = { create: vi.fn(() => embeddingProvider) };
  const service = new AiService(config as never, db as never, factory as never);
  return { service, logs, config, embeddingProvider };
}

describe('AiService.completeJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.create.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the prompt, disables SDK retries, validates JSON, and logs raw I/O and usage', async () => {
    sdk.create.mockResolvedValueOnce(completion('```json\n{"answer":"ok"}\n```'));
    const { service, logs } = makeService({
      ANTHROPIC_INPUT_COST_PER_MILLION: '3',
      ANTHROPIC_OUTPUT_COST_PER_MILLION: '15',
    });

    await expect(service.completeJson('cv_parse', { cv_text: 'Jane Doe CV' }, schema)).resolves.toEqual({
      answer: 'ok',
    });

    expect(sdk.constructorOptions).toHaveBeenCalledWith({ apiKey: 'test-key', maxRetries: 0 });
    expect(sdk.create).toHaveBeenCalledOnce();
    const [request, options] = sdk.create.mock.calls[0];
    expect(request.messages[0].content).toContain('<cv>\nJane Doe CV\n</cv>');
    expect(options).toEqual({ timeout: 60_000 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      promptName: 'cv_parse',
      model: 'claude-test',
      success: true,
      status: 'success',
      attempt: 1,
      tokensIn: 100,
      tokensOut: 10,
      costUsd: '0.000450',
      rawOutput: completion('```json\n{"answer":"ok"}\n```'),
    });
    expect(logs[0].rawInput).toMatchObject({ stage: 'initial' });
    expect(JSON.stringify(logs[0].rawInput)).toContain('Jane Doe CV');
  });

  it('uses exactly one repair for schema-invalid output and logs both model calls', async () => {
    sdk.create
      .mockResolvedValueOnce(completion('{"answer":42}'))
      .mockResolvedValueOnce(completion('{"answer":"repaired"}'));
    const { service, logs } = makeService();

    await expect(service.completeJson('cv_parse', { cv_text: 'CV' }, schema)).resolves.toEqual({
      answer: 'repaired',
    });
    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(sdk.create.mock.calls[1][0].messages[0].content).toContain('<invalid_response>');
    expect(sdk.create.mock.calls[1][0].messages[0].content).toContain('"answer":42');
    expect(logs.map((log) => log.status)).toEqual(['retried', 'success']);
    expect(logs.map((log) => log.success)).toEqual([false, true]);
    expect(logs[0].rawOutput).toMatchObject({ content: [{ text: '{"answer":42}' }] });
  });

  it('does not start another repair cycle when the repair is also invalid JSON', async () => {
    sdk.create.mockResolvedValueOnce(completion('not json')).mockResolvedValueOnce(completion('still not json'));
    const { service, logs } = makeService();

    await expect(service.completeJson('cv_parse', { cv_text: 'CV' }, schema)).rejects.toThrow('after one repair');
    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({ success: false, status: 'failed' });
  });

  it('allows an initial call plus three 429/5xx retries with backoff and logs every attempt', async () => {
    vi.useFakeTimers();
    sdk.create
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('server 1'), { status: 500 }))
      .mockRejectedValueOnce(Object.assign(new Error('server 2'), { status: 503 }))
      .mockResolvedValueOnce(completion('{"answer":"eventual"}'));
    const { service, logs } = makeService();

    const result = service.completeJson('cv_parse', { cv_text: 'CV' }, schema);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ answer: 'eventual' });
    expect(sdk.create).toHaveBeenCalledTimes(4);
    expect(logs.map((log) => log.attempt)).toEqual([1, 2, 3, 4]);
    expect(logs.map((log) => log.status)).toEqual(['retried', 'retried', 'retried', 'success']);
    expect(logs.slice(0, 3).every((log) => log.rawOutput === null)).toBe(true);
  });

  it('stops after the third retry when the provider remains unavailable', async () => {
    vi.useFakeTimers();
    const unavailable = Object.assign(new Error('unavailable'), { status: 500 });
    sdk.create.mockRejectedValue(unavailable);
    const { service, logs } = makeService();

    const result = service.completeJson('cv_parse', { cv_text: 'CV' }, schema);
    const assertion = expect(result).rejects.toBe(unavailable);
    await vi.runAllTimersAsync();

    await assertion;
    expect(sdk.create).toHaveBeenCalledTimes(4);
    expect(logs).toHaveLength(4);
    expect(logs[3].status).toBe('failed');
  });

  it('does not retry a non-retryable 4xx response', async () => {
    const badRequest = Object.assign(new Error('bad request'), { status: 400 });
    sdk.create.mockRejectedValueOnce(badRequest);
    const { service, logs } = makeService();

    await expect(service.completeJson('cv_parse', { cv_text: 'CV' }, schema)).rejects.toBe(badRequest);
    expect(sdk.create).toHaveBeenCalledOnce();
    expect(logs[0]).toMatchObject({ success: false, status: 'failed', attempt: 1 });
  });

  it('applies the 60-second request timeout, logs the failed call, and does not retry timeouts', async () => {
    const timeout = new Error('request timed out');
    sdk.create.mockRejectedValueOnce(timeout);
    const { service, logs } = makeService();

    await expect(service.completeJson('cv_parse', { cv_text: 'CV' }, schema)).rejects.toBe(timeout);
    expect(sdk.create).toHaveBeenCalledOnce();
    expect(sdk.create.mock.calls[0][1]).toEqual({ timeout: 60_000 });
    expect(logs[0]).toMatchObject({ success: false, status: 'failed', rawOutput: null, errorMessage: String(timeout) });
    expect(logs[0].rawInput).toBeTruthy();
  });
});
