import { describe, expect, it } from 'vitest';
import { ProviderError } from '../errors';
import { readSse } from '../http';
import type { GenerateRequest } from '../types';
import { GeminiProvider, normalize } from './gemini';
import { OpenAICompatibleProvider, parseGuardScore } from './openai-compatible';

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function mockFetch(responses: Array<(call: Call) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = {
      url,
      body: JSON.parse(String(init.body)),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    };
    calls.push(call);
    const respond = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const request: GenerateRequest = {
  system: 'You are Leaf.',
  messages: [{ role: 'user', content: 'Classify this.' }],
  schema: {
    name: 'x',
    jsonSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  },
  maxOutputTokens: 500,
};

describe('GeminiProvider', () => {
  it('sends system instruction, schema and thinking level, and parses usage', async () => {
    const { fetchImpl, calls } = mockFetch([
      () =>
        json({
          candidates: [
            {
              content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"a":"b"}' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8, thoughtsTokenCount: 30 },
        }),
    ]);
    const provider = new GeminiProvider('key-123', { fetch: fetchImpl });
    const result = await provider.generate(
      { provider: 'gemini', model: 'gemini-3.8-flash', reasoning: 'low' },
      request,
      AbortSignal.timeout(1000),
    );
    expect(result.text).toBe('{"a":"b"}');
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 8,
      reasoningTokens: 30,
      cachedInputTokens: 0,
    });
    const call = calls[0]!;
    expect(call.url).toContain('/models/gemini-3.8-flash:generateContent');
    expect(call.headers['x-goog-api-key']).toBe('key-123');
    expect(call.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'You are Leaf.' }] },
      generationConfig: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'low' },
        maxOutputTokens: 500,
      },
    });
  });

  it('negotiates the structured-output shape when a model rejects the first one', async () => {
    const { fetchImpl, calls } = mockFetch([
      () =>
        json({ error: { message: 'Invalid JSON payload received. Unknown name "responseJsonSchema"' } }, 400),
      () => json({ candidates: [{ content: { parts: [{ text: '{"a":"b"}' }] } }] }),
      () => json({ candidates: [{ content: { parts: [{ text: '{"a":"c"}' }] } }] }),
    ]);
    const provider = new GeminiProvider('k', { fetch: fetchImpl });
    const ref = { provider: 'gemini' as const, model: 'm' };
    await provider.generate(ref, request, AbortSignal.timeout(1000));
    await provider.generate(ref, request, AbortSignal.timeout(1000));
    expect(calls[1]!.body.generationConfig).toHaveProperty('responseFormat');
    expect(calls[2]!.body.generationConfig).toHaveProperty('responseFormat'); // remembered
  });

  it('classifies quota exhaustion and blocked prompts', async () => {
    const quota = new GeminiProvider('k', {
      fetch: mockFetch([
        () =>
          json(
            {
              error: {
                status: 'RESOURCE_EXHAUSTED',
                message: 'Quota exceeded for GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                details: [{ retryDelay: '40s' }],
              },
            },
            429,
          ),
      ]).fetchImpl,
    });
    const error = await quota
      .generate({ provider: 'gemini', model: 'm' }, request, AbortSignal.timeout(1000))
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe('quota_exhausted');
    expect(error.retryAfterMs).toBe(40_000);

    const blocked = new GeminiProvider('k', {
      fetch: mockFetch([() => json({ promptFeedback: { blockReason: 'SAFETY' } })]).fetchImpl,
    });
    await expect(
      blocked.generate({ provider: 'gemini', model: 'm' }, request, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ kind: 'safety' });
  });

  it('streams SSE chunks and skips thought parts', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"x","thought":true}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"{\\"a\\":"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"\\"b\\"}"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":4}}',
      '',
    ].join('\n\n');
    const provider = new GeminiProvider('k', {
      fetch: mockFetch([() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } })])
        .fetchImpl,
    });
    const chunks: string[] = [];
    let done = '';
    for await (const chunk of provider.stream(
      { provider: 'gemini', model: 'm' },
      request,
      AbortSignal.timeout(1000),
    )) {
      if (chunk.type === 'text') chunks.push(chunk.text);
      else done = chunk.result.text;
    }
    expect(chunks.join('')).toBe('{"a":"b"}');
    expect(done).toBe('{"a":"b"}');
  });

  it('normalises truncated embeddings', () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
});

describe('readSse', () => {
  const collect = async (...reads: string[]) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const read of reads) controller.enqueue(encoder.encode(read));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const data of readSse(body)) out.push(data);
    return out;
  };

  it('splits CRLF-framed events, including several in the final read', async () => {
    // Google's framing; the old parser glued the last read's events together and dropped them.
    expect(await collect('data: 1\r\n\r\n', 'data: 2\r\n\r\ndata: 3\r\n\r\n')).toEqual(['1', '2', '3']);
  });

  it('copes with a CRLF split across reads and a last event without its blank line', async () => {
    expect(await collect('data: 1\r', '\n\r\ndata: 2\n\ndata: 3')).toEqual(['1', '2', '3']);
  });

  it('joins multi-line data fields and ignores other fields', async () => {
    expect(await collect('event: delta\nid: 7\ndata: a\ndata: b\n\n')).toEqual(['a\nb']);
  });
});

describe('OpenAICompatibleProvider', () => {
  const groq = (fetchImpl: typeof fetch) =>
    new OpenAICompatibleProvider({
      id: 'groq',
      apiKey: 'gsk',
      baseUrl: 'https://api.groq.test/openai/v1',
      maxTokensField: 'max_completion_tokens',
      streamsStructuredOutput: false,
      fetch: fetchImpl,
    });

  it('uses strict JSON schema and hides reasoning for gpt-oss models', async () => {
    const { fetchImpl, calls } = mockFetch([
      () =>
        json({
          choices: [{ message: { content: '{"a":"b"}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 5 },
        }),
    ]);
    const result = await groq(fetchImpl).generate(
      { provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'minimal' },
      request,
      AbortSignal.timeout(1000),
    );
    expect(result.text).toBe('{"a":"b"}');
    expect(calls[0]!.headers.authorization).toBe('Bearer gsk');
    expect(calls[0]!.body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true } },
      reasoning_effort: 'low',
      include_reasoning: false,
      max_completion_tokens: 500,
    });
  });

  it('downgrades to JSON mode when a model rejects json_schema', async () => {
    const { fetchImpl, calls } = mockFetch([
      () => json({ error: { message: 'response_format json_schema is not supported for this model' } }, 400),
      () => json({ choices: [{ message: { content: '{"a":"b"}' } }] }),
    ]);
    await groq(fetchImpl).generate({ provider: 'groq', model: 'other' }, request, AbortSignal.timeout(1000));
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' });
    expect(String((calls[1]!.body.messages as Array<{ content: string }>)[0]!.content)).toContain(
      'JSON Schema',
    );
  });

  it('parses Prompt Guard output in either format', () => {
    expect(parseGuardScore('0.9991')).toBeCloseTo(0.9991);
    expect(parseGuardScore('MALICIOUS')).toBe(0.99);
    expect(parseGuardScore('BENIGN')).toBe(0.01);
    expect(parseGuardScore('???')).toBeNull();
  });
});
