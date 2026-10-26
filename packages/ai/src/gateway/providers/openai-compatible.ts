import { errorFromResponse, ProviderError } from '../errors';
import { type FetchLike, providerFetch, readSse } from '../http';
import type {
  GenerateRequest,
  GenerateResult,
  GuardProvider,
  LlmProvider,
  ModelRef,
  ProviderId,
  StreamChunk,
  Usage,
} from '../types';

/** How a model is asked for JSON, from strongest to weakest guarantee. */
type JsonMode = 'json_schema' | 'json_object' | 'prompt';

export interface OpenAICompatibleConfig {
  id: Extract<ProviderId, 'groq' | 'openrouter'>;
  apiKey: string;
  baseUrl: string;
  /** Extra headers (OpenRouter attribution). */
  headers?: Record<string, string>;
  /** Groq names it max_completion_tokens; OpenRouter uses max_tokens. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Groq rejects streaming together with structured output. */
  streamsStructuredOutput: boolean;
  fetch?: FetchLike;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function usageOf(usage: ChatCompletion['usage']): Usage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

function finishReasonOf(reason: string | null | undefined): GenerateResult['finishReason'] {
  if (!reason || reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'safety';
  return 'other';
}

const isReasoningModel = (model: string) => /gpt-oss|qwen3|deepseek-r|o\d-|reason/i.test(model);

/**
 * Adapter for OpenAI-compatible chat completion APIs (Groq, OpenRouter). Structured output is
 * negotiated per model: strict JSON schema where supported, then JSON mode, then a prompt-level
 * schema — the response is always validated by the pipeline regardless.
 */
export class OpenAICompatibleProvider implements LlmProvider, GuardProvider {
  readonly id: Extract<ProviderId, 'groq' | 'openrouter'>;
  private readonly jsonModes = new Map<string, JsonMode>();

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.id = config.id;
  }

  private get fetchImpl(): FetchLike {
    return this.config.fetch ?? fetch;
  }

  canStream(_ref: ModelRef, request: GenerateRequest): boolean {
    return !request.schema || this.config.streamsStructuredOutput;
  }

  private body(ref: ModelRef, request: GenerateRequest, mode: JsonMode, stream: boolean) {
    let system = request.system;
    if (request.schema && mode !== 'json_schema') {
      system += `\n\nRespond with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(request.schema.jsonSchema)}`;
    }
    const body: Record<string, unknown> = {
      model: ref.model,
      messages: [{ role: 'system', content: system }, ...request.messages],
      temperature: request.temperature ?? 0.3,
      [this.config.maxTokensField]: request.maxOutputTokens,
      stream,
    };
    if (stream) body.stream_options = { include_usage: true };
    if (ref.reasoning && isReasoningModel(ref.model)) {
      body.reasoning_effort = ref.reasoning === 'minimal' ? 'low' : ref.reasoning;
      if (this.id === 'groq') body.include_reasoning = false;
    }
    if (request.schema && mode === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: request.schema.name, strict: true, schema: request.schema.jsonSchema },
      };
    } else if (request.schema && mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  private async post(body: Record<string, unknown>, model: string, signal: AbortSignal): Promise<Response> {
    const response = await providerFetch(
      this.fetchImpl,
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal,
      },
      { provider: this.id, model },
    );
    if (!response.ok) {
      throw errorFromResponse(this.id, model, response.status, await response.text(), response.headers);
    }
    return response;
  }

  async generate(ref: ModelRef, request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
    const ladder: JsonMode[] = request.schema ? ['json_schema', 'json_object', 'prompt'] : ['prompt'];
    const start = this.jsonModes.get(ref.model);
    const modes = start ? ladder.slice(ladder.indexOf(start)) : ladder;

    let lastError: unknown;
    for (const mode of modes) {
      try {
        const response = await this.post(this.body(ref, request, mode, false), ref.model, signal);
        const json = (await response.json()) as ChatCompletion;
        const choice = json.choices?.[0];
        const text = choice?.message?.content?.trim() ?? '';
        const finishReason = finishReasonOf(choice?.finish_reason);
        if (!text) {
          throw new ProviderError(
            finishReason === 'safety' ? 'safety' : 'invalid_output',
            'Empty completion',
            {
              provider: this.id,
              model: ref.model,
            },
          );
        }
        if (request.schema) this.jsonModes.set(ref.model, mode);
        return { text, usage: usageOf(json.usage), finishReason, model: json.model ?? ref.model };
      } catch (error) {
        lastError = error;
        const formatRejected =
          error instanceof ProviderError &&
          error.kind === 'bad_request' &&
          /response_format|json_schema|json_object|structured|schema/i.test(error.message);
        if (!formatRejected) throw error;
      }
    }
    throw lastError;
  }

  async *stream(ref: ModelRef, request: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    const mode: JsonMode = request.schema ? (this.jsonModes.get(ref.model) ?? 'json_schema') : 'prompt';
    const response = await this.post(this.body(ref, request, mode, true), ref.model, signal);
    if (!response.body) {
      throw new ProviderError('invalid_output', 'Streaming response had no body', {
        provider: this.id,
        model: ref.model,
      });
    }
    let text = '';
    let usage = usageOf(undefined);
    let finish: string | null | undefined;
    let model = ref.model;
    for await (const data of readSse(response.body)) {
      if (data === '[DONE]') break;
      let chunk: ChatCompletion & { choices?: Array<{ delta?: { content?: string | null } }> };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0] as {
        delta?: { content?: string | null };
        finish_reason?: string | null;
      };
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: 'text', text: delta };
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = usageOf(chunk.usage);
      if (chunk.model) model = chunk.model;
    }
    if (!text) {
      throw new ProviderError('invalid_output', 'Empty streamed completion', {
        provider: this.id,
        model: ref.model,
      });
    }
    yield { type: 'done', result: { text, usage, finishReason: finishReasonOf(finish), model } };
  }

  /**
   * Prompt Guard 2 classifiers answer with a probability (or a label) as the message content.
   * The parser accepts both so a format change cannot silently disable the guard.
   */
  async score(model: string, text: string, signal: AbortSignal) {
    const response = await this.post(
      {
        model,
        messages: [{ role: 'user', content: text }],
        temperature: 0,
        [this.config.maxTokensField]: 16,
      },
      model,
      signal,
    );
    const json = (await response.json()) as ChatCompletion;
    const content = json.choices?.[0]?.message?.content?.trim() ?? '';
    return { score: parseGuardScore(content), inputTokens: json.usage?.prompt_tokens ?? 0 };
  }
}

export function parseGuardScore(content: string): number | null {
  const numeric = Number.parseFloat(content);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) return numeric;
  if (/malicious|jailbreak|injection|unsafe/i.test(content)) return 0.99;
  if (/benign|safe/i.test(content)) return 0.01;
  return null;
}
