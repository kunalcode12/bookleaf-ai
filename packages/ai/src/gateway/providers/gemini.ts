import { errorFromResponse, ProviderError } from '../errors';
import { type FetchLike, providerFetch, readSse } from '../http';
import type {
  EmbeddingProvider,
  GenerateRequest,
  GenerateResult,
  LlmProvider,
  ModelRef,
  StreamChunk,
  Usage,
} from '../types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Structured-output request shapes. The REST surface accepts `responseMimeType` +
 * `responseJsonSchema`; newer docs describe `responseFormat.text`. The adapter starts with the
 * first, falls back to the second if a model rejects it, and remembers what worked per model.
 */
type SchemaMode = 'responseJsonSchema' | 'responseFormat';

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
}

const SAFETY_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

function finishReasonOf(reason: string | undefined): GenerateResult['finishReason'] {
  if (!reason || reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (SAFETY_REASONS.has(reason)) return 'safety';
  return 'other';
}

function usageOf(meta: GeminiResponse['usageMetadata']): Usage {
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
    reasoningTokens: meta?.thoughtsTokenCount ?? 0,
    cachedInputTokens: meta?.cachedContentTokenCount ?? 0,
  };
}

function visibleText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

export class GeminiProvider implements LlmProvider, EmbeddingProvider {
  readonly id = 'gemini' as const;
  private readonly schemaModes = new Map<string, SchemaMode>();

  constructor(
    private readonly apiKey: string,
    private readonly options: { baseUrl?: string; fetch?: FetchLike; embeddingDimensions?: number } = {},
  ) {}

  private get baseUrl() {
    return this.options.baseUrl ?? DEFAULT_BASE_URL;
  }

  private get fetchImpl(): FetchLike {
    return this.options.fetch ?? fetch;
  }

  canStream(): boolean {
    return true;
  }

  private body(ref: ModelRef, request: GenerateRequest, mode: SchemaMode) {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature ?? 0.3,
    };
    if (ref.reasoning) {
      // Gemini 3.x uses discrete thinking levels; 2.5-series models take a token budget instead.
      generationConfig.thinkingConfig = ref.model.startsWith('gemini-2.5')
        ? { thinkingBudget: { minimal: 0, low: 512, medium: 2048, high: 8192 }[ref.reasoning] }
        : { thinkingLevel: ref.reasoning };
    }
    if (request.schema) {
      if (mode === 'responseJsonSchema') {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = request.schema.jsonSchema;
      } else {
        generationConfig.responseFormat = {
          text: { mimeType: 'APPLICATION_JSON', schema: request.schema.jsonSchema },
        };
      }
    }
    return {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig,
    };
  }

  private async post(
    ref: ModelRef,
    request: GenerateRequest,
    mode: SchemaMode,
    signal: AbortSignal,
    stream: boolean,
  ): Promise<Response> {
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `${this.baseUrl}/models/${encodeURIComponent(ref.model)}:${method}`;
    const response = await providerFetch(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(this.body(ref, request, mode)),
        signal,
      },
      { provider: this.id, model: ref.model },
    );
    if (!response.ok) {
      throw errorFromResponse(this.id, ref.model, response.status, await response.text(), response.headers);
    }
    return response;
  }

  /** Runs `attempt` with the remembered schema mode, switching once if the model rejects it. */
  private async negotiate<T>(
    ref: ModelRef,
    request: GenerateRequest,
    attempt: (mode: SchemaMode) => Promise<T>,
  ): Promise<T> {
    const mode = this.schemaModes.get(ref.model) ?? 'responseJsonSchema';
    try {
      return await attempt(mode);
    } catch (error) {
      const schemaRejected =
        request.schema &&
        error instanceof ProviderError &&
        error.kind === 'bad_request' &&
        /responseJsonSchema|responseFormat|response_format|Unknown name|Invalid JSON payload|schema/i.test(
          error.message,
        );
      if (!schemaRejected) throw error;
      const alternative: SchemaMode = mode === 'responseJsonSchema' ? 'responseFormat' : 'responseJsonSchema';
      const result = await attempt(alternative);
      this.schemaModes.set(ref.model, alternative);
      return result;
    }
  }

  async generate(ref: ModelRef, request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
    return this.negotiate(ref, request, async (mode) => {
      const response = await this.post(ref, request, mode, signal, false);
      const json = (await response.json()) as GeminiResponse;
      return this.toResult(ref, json);
    });
  }

  private toResult(ref: ModelRef, json: GeminiResponse): GenerateResult {
    if (json.promptFeedback?.blockReason) {
      throw new ProviderError('safety', `Prompt blocked: ${json.promptFeedback.blockReason}`, {
        provider: this.id,
        model: ref.model,
      });
    }
    const finishReason = finishReasonOf(json.candidates?.[0]?.finishReason);
    const text = visibleText(json);
    if (!text) {
      throw new ProviderError(
        finishReason === 'safety' ? 'safety' : 'invalid_output',
        `Empty response (finishReason=${json.candidates?.[0]?.finishReason ?? 'none'})`,
        { provider: this.id, model: ref.model },
      );
    }
    return { text, usage: usageOf(json.usageMetadata), finishReason, model: json.modelVersion ?? ref.model };
  }

  async *stream(ref: ModelRef, request: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    const response = await this.negotiate(ref, request, (mode) =>
      this.post(ref, request, mode, signal, true),
    );
    if (!response.body) {
      throw new ProviderError('invalid_output', 'Streaming response had no body', {
        provider: this.id,
        model: ref.model,
      });
    }
    let text = '';
    let usage: Usage = usageOf(undefined);
    let finish: string | undefined;
    let model = ref.model;
    for await (const data of readSse(response.body)) {
      let event: GeminiResponse;
      try {
        event = JSON.parse(data) as GeminiResponse;
      } catch {
        continue;
      }
      if (event.promptFeedback?.blockReason) {
        throw new ProviderError('safety', `Prompt blocked: ${event.promptFeedback.blockReason}`, {
          provider: this.id,
          model: ref.model,
        });
      }
      const delta = visibleText(event);
      if (delta) {
        text += delta;
        yield { type: 'text', text: delta };
      }
      if (event.usageMetadata) usage = usageOf(event.usageMetadata);
      finish = event.candidates?.[0]?.finishReason ?? finish;
      model = event.modelVersion ?? model;
    }
    if (!text) {
      throw new ProviderError(
        'invalid_output',
        `Empty streamed response (finishReason=${finish ?? 'none'})`,
        {
          provider: this.id,
          model: ref.model,
        },
      );
    }
    yield { type: 'done', result: { text, usage, finishReason: finishReasonOf(finish), model } };
  }

  async embed(model: string, texts: string[], kind: 'document' | 'query', signal: AbortSignal) {
    const dimensions = this.options.embeddingDimensions ?? 768;
    const response = await providerFetch(
      this.fetchImpl,
      `${this.baseUrl}/models/${encodeURIComponent(model)}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            outputDimensionality: dimensions,
          })),
        }),
        signal,
      },
      { provider: this.id, model },
    );
    if (!response.ok) {
      throw errorFromResponse(this.id, model, response.status, await response.text(), response.headers);
    }
    const json = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
    const vectors = (json.embeddings ?? []).map((e) => normalize(e.values ?? []));
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== dimensions)) {
      throw new ProviderError('invalid_output', 'Embedding response shape mismatch', {
        provider: this.id,
        model,
      });
    }
    // The embeddings endpoint does not report usage; estimate for telemetry.
    const inputTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    return { vectors, inputTokens };
  }
}

/** gemini-embedding-001 only pre-normalises 3072-d vectors; truncated ones need L2 normalisation. */
export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}
