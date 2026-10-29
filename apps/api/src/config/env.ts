import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? fallback : ['true', '1', 'yes'].includes(v)));

/** Comma-separated list; the fallback applies when the variable is unset. */
const csv = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** `::` listens on IPv6 and IPv4 (Railway's private network is IPv6-only). */
    HOST: z.string().default('::'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Web origins allowed for CORS and cookie-authenticated writes (CSRF origin check). */
    APP_ORIGINS: csv('http://localhost:3000'),
    PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
    PUBLIC_API_URL: z.url().default('http://localhost:4000'),
    TRUST_PROXY: bool(true),

    DATABASE_URL: z.string().min(1).default('pglite://./.data/pglite'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
    AUTO_MIGRATE: bool(true),
    /** Seed the sample dataset automatically when the database is empty (local/demo). */
    AUTO_SEED: bool(false),

    AUTH_PROVIDER: z.enum(['supabase', 'local']).default('local'),
    SUPABASE_URL: z
      .url()
      .optional()
      .transform((v) => v?.replace(/\/+$/, '') ?? null),
    SUPABASE_PUBLISHABLE_KEY: optionalSecret,
    SUPABASE_SECRET_KEY: optionalSecret,
    /** Only for Supabase projects still on legacy HS256 JWT signing. */
    SUPABASE_JWT_SECRET: optionalSecret,
    LOCAL_AUTH_SECRET: z.string().min(32).default('local-development-only-secret-do-not-use-in-prod'),
    LOCAL_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
    COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

    STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
    STORAGE_BUCKET: z.string().default('ticket-attachments'),
    LOCAL_STORAGE_DIR: z.string().default('./.data/uploads'),
    /** HMAC key for local signed upload/download links. */
    FILE_SIGNING_SECRET: z.string().min(32).default('local-file-signing-secret-change-me-in-prod'),

    GEMINI_API_KEY: optionalSecret,
    GROQ_API_KEY: optionalSecret,
    OPENROUTER_API_KEY: optionalSecret,
    LEAF_ROUTE_TRIAGE: optionalSecret,
    LEAF_ROUTE_DRAFT: optionalSecret,
    LEAF_ROUTE_ASSIST: optionalSecret,
    LEAF_ROUTE_SUMMARIZE: optionalSecret,
    LEAF_EMBEDDING_MODEL: optionalSecret,
    LEAF_GUARD_MODEL: optionalSecret,
    LEAF_RATE_LIMITS: optionalSecret,
    LEAF_ALLOWED_LINK_DOMAINS: csv(),
    /** Set when AI providers bill this project (free tiers cost $0; estimates still show list price). */
    LEAF_PAID_TIER: bool(false),

    RESEND_API_KEY: optionalSecret,
    EMAIL_FROM: z.string().default('BookLeaf Author Support <support@bookleaf.test>'),

    /** inline: workers run inside the API process. off: run `pnpm start:worker` separately. */
    WORKER_MODE: z.enum(['inline', 'off']).default('inline'),
    DEMO_MODE: bool(true),
    SEED_AUTHOR_PASSWORD: z.string().min(8).default('BookLeaf@Author1'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default('BookLeaf@Admin1'),
    /** Optional shared secret the web proxy adds; when set, direct calls without it are rejected. */
    ORIGIN_SECRET: optionalSecret,
  })
  .superRefine((env, ctx) => {
    const require = (field: keyof typeof env, reason: string) => {
      if (!env[field]) ctx.addIssue({ code: 'custom', path: [field], message: `Required ${reason}` });
    };
    if (env.AUTH_PROVIDER === 'supabase') {
      require('SUPABASE_URL', 'when AUTH_PROVIDER=supabase');
      require('SUPABASE_PUBLISHABLE_KEY', 'when AUTH_PROVIDER=supabase');
      require('SUPABASE_SECRET_KEY', 'when AUTH_PROVIDER=supabase');
    }
    if (env.STORAGE_PROVIDER === 'supabase') {
      require('SUPABASE_URL', 'when STORAGE_PROVIDER=supabase');
      require('SUPABASE_SECRET_KEY', 'when STORAGE_PROVIDER=supabase');
    }
    if (env.NODE_ENV === 'production') {
      if (env.AUTH_PROVIDER === 'local') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_PROVIDER'],
          message: 'Local auth is for development only; use AUTH_PROVIDER=supabase in production',
        });
      }
      if (env.FILE_SIGNING_SECRET.startsWith('local-')) {
        ctx.addIssue({
          code: 'custom',
          path: ['FILE_SIGNING_SECRET'],
          message: 'Set a real secret in production',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  isProduction: boolean;
  isTest: boolean;
  cookieSecure: boolean;
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Parses and validates the environment. The server refuses to start with invalid config. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  const env = result.data;
  const cookieSecure =
    env.COOKIE_SECURE === 'auto' ? env.PUBLIC_APP_URL.startsWith('https://') : env.COOKIE_SECURE === 'true';
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    cookieSecure,
  };
}
