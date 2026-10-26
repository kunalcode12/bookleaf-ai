import { neutralizeMarkup } from '../text/sanitize';

/**
 * Random per-request suffix for prompt section tags (e.g. `<thread_k3f9a1>`). An attacker cannot
 * predict it, and `neutralizeMarkup` already removed any `<`/`>` from untrusted text, so author
 * content can never close a section early or forge a new one ("spotlighting" by delimiting).
 */
export function createNonce(): string {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function untrustedBlock(tag: string, nonce: string, content: string): string {
  return `<${tag}_${nonce}>\n${neutralizeMarkup(content)}\n</${tag}_${nonce}>`;
}

/** Canary embedded in system prompts; if it ever appears in output, the prompt leaked. */
export function createCanary(): string {
  return `LEAF-${createNonce().toUpperCase()}`;
}

export function containsCanary(text: string, canary: string): boolean {
  return text.includes(canary) || /LEAF-[0-9A-F]{10}/.test(text);
}
