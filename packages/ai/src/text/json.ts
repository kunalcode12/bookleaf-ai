export class InvalidJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJsonError';
  }
}

/**
 * Extracts the first complete JSON object from model output. Tolerates markdown fences and stray
 * prose around the object (common with providers that lack strict schema enforcement).
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/^\u{FEFF}/u, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to a balanced scan
  }
  const start = cleaned.indexOf('{');
  if (start === -1) throw new InvalidJsonError('No JSON object found in model output');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch (error) {
          throw new InvalidJsonError(`Malformed JSON in model output: ${(error as Error).message}`);
        }
      }
    }
  }
  throw new InvalidJsonError('Unterminated JSON object in model output');
}

/**
 * Incrementally decodes one top-level string field (e.g. "reply") out of a JSON object that is
 * still streaming in, so the draft can be shown token by token while the rest of the structured
 * output (facts used, escalation flags…) is still being generated.
 */
export class StreamingStringField {
  private buffer = '';
  private cursor = -1;
  private done = false;
  private decoded = '';

  constructor(private readonly field: string) {}

  /** Feed the next raw chunk; returns newly decoded characters of the field's value. */
  push(chunk: string): string {
    if (this.done) return '';
    this.buffer += chunk;
    if (this.cursor < 0) {
      const match = new RegExp(`"${this.field}"\\s*:\\s*"`).exec(this.buffer);
      if (!match) return '';
      this.cursor = match.index + match[0].length;
    }
    let out = '';
    while (this.cursor < this.buffer.length) {
      const ch = this.buffer[this.cursor]!;
      if (ch === '"') {
        this.done = true;
        break;
      }
      if (ch !== '\\') {
        out += ch;
        this.cursor += 1;
        continue;
      }
      // Escape sequence: wait until it is complete before decoding.
      const next = this.buffer[this.cursor + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = this.buffer.slice(this.cursor + 2, this.cursor + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.cursor += 6;
        continue;
      }
      const map: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        b: '\b',
        f: '\f',
        '"': '"',
        '\\': '\\',
        '/': '/',
      };
      out += map[next] ?? next;
      this.cursor += 2;
    }
    this.decoded += out;
    return out;
  }

  get value(): string {
    return this.decoded;
  }
}
