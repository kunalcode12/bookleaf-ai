import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { LIMITS } from '@bookleaf/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StorageProvider {
  readonly kind: 'local' | 'supabase';
  init(): Promise<void>;
  createUploadTarget(key: string, mimeType: string): Promise<UploadTarget>;
  exists(key: string): Promise<boolean>;
  downloadUrl(key: string, fileName: string): Promise<string>;
}

const UPLOAD_TTL_SECONDS = 600;
const DOWNLOAD_TTL_SECONDS = 600;

/** HMAC-signed, expiring tokens for local file links (stand-in for a storage service's signed URLs). */
export class FileSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(secret);
  }

  sign(payload: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(
      JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.key).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  verify<T extends Record<string, unknown>>(token: string): T | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.key).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
  }
}

/** Development storage on local disk, behind signed /api/v1/files URLs. */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(
    dir: string,
    private readonly signer: FileSigner,
  ) {
    this.root = path.resolve(dir);
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  private pathFor(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async createUploadTarget(key: string, mimeType: string): Promise<UploadTarget> {
    const token = this.signer.sign({ k: key, m: mimeType, op: 'put' }, UPLOAD_TTL_SECONDS);
    return {
      url: `/api/v1/files/upload/${token}`,
      method: 'PUT',
      headers: { 'content-type': mimeType },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch {
      return false;
    }
  }

  async downloadUrl(key: string, fileName: string): Promise<string> {
    return `/api/v1/files/download/${this.signer.sign({ k: key, n: fileName, op: 'get' }, DOWNLOAD_TTL_SECONDS)}`;
  }

  /** Writes an upload atomically (temp file + rename). */
  async write(key: string, data: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, data);
    await rename(temp, target);
  }

  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }
}

/** Supabase Storage: private bucket, uploads and downloads only through short-lived signed URLs. */
export class SupabaseStorageProvider implements StorageProvider {
  readonly kind = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    secretKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async init(): Promise<void> {
    const { error } = await this.client.storage.getBucket(this.bucket);
    if (!error) return;
    const created = await this.client.storage.createBucket(this.bucket, {
      public: false,
      fileSizeLimit: LIMITS.attachments.maxBytes,
      allowedMimeTypes: [...LIMITS.attachments.mimeTypes],
    });
    if (created.error && !/already exists/i.test(created.error.message)) {
      throw new Error(`Could not create storage bucket "${this.bucket}": ${created.error.message}`);
    }
  }

  async createUploadTarget(key: string, mimeType: string): Promise<UploadTarget> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error || !data) throw new Error(`Could not create upload URL: ${error?.message ?? 'unknown'}`);
    return {
      url: data.signedUrl,
      method: 'PUT',
      headers: { 'content-type': mimeType, 'x-upsert': 'false' },
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
    };
  }

  async exists(key: string): Promise<boolean> {
    const { data } = await this.client.storage.from(this.bucket).exists(key);
    return Boolean(data);
  }

  async downloadUrl(key: string, fileName: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, DOWNLOAD_TTL_SECONDS, { download: fileName });
    if (error || !data) throw new Error(`Could not sign download URL: ${error?.message ?? 'unknown'}`);
    return data.signedUrl;
  }
}
