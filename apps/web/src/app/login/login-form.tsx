'use client';

import type { DemoAccountsResponse, SessionResponse } from '@bookleaf/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, KeyRound, Sparkles, TriangleAlert } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { InlineNotice } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { api, isApiError } from '@/lib/api/client';
import { keys } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

function safeNext(next: string | null, role: 'author' | 'admin'): string {
  const home = role === 'admin' ? '/desk' : '/home';
  if (!next?.startsWith('/') || next.startsWith('//')) return home;
  const adminPath = next.startsWith('/desk');
  if (role === 'admin' ? !adminPath : adminPath) return home;
  return next;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  const demo = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => api.get<DemoAccountsResponse>('/auth/demo-accounts'),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  // Already signed in? Skip the form.
  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionResponse>('/auth/session')
      .then((session) => {
        if (!cancelled) router.replace(safeNext(params.get('next'), session.user.role));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router, params]);

  async function signIn(credentials: { email: string; password: string }, source: string) {
    setPending(source);
    setError(null);
    try {
      const session = await api.post<SessionResponse>('/auth/login', credentials);
      client.setQueryData(keys.session, session);
      router.replace(safeNext(params.get('next'), session.user.role));
    } catch (err) {
      setPending(null);
      if (!isApiError(err)) {
        setError({ message: 'Something went wrong. Please try again.', fields: {} });
        return;
      }
      const fields: Record<string, string> = {};
      for (const f of err.fieldErrors) fields[f.path] = f.message;
      setError({
        message:
          err.code === 'INVALID_CREDENTIALS'
            ? "That email and password don't match a BookLeaf account."
            : err.code === 'RATE_LIMITED'
              ? 'Too many attempts. Please wait a few minutes before trying again.'
              : err.message,
        fields,
      });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void signIn({ email: email.trim(), password }, 'form');
  }

  const authors = demo.data?.accounts.filter((a) => a.role === 'author') ?? [];
  const team = demo.data?.accounts.filter((a) => a.role === 'admin') ?? [];

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-5xl font-black leading-none">Sign in</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">
        Welcome back. Your books and conversations are waiting.
      </p>

      {params.get('expired') && (
        <InlineNotice tone="warning" icon={<KeyRound />} className="mt-6" title="Your session ended">
          For your security we signed you out. Please sign in again.
        </InlineNotice>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <Field id="email" label="Email" error={error?.fields.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error?.fields.email) || undefined}
            required
          />
        </Field>
        <Field id="password" label="Password" error={error?.fields.password}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error?.fields.password) || undefined}
              className="pr-12"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground transition hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        {error && !Object.keys(error.fields).length && (
          <InlineNotice tone="danger" icon={<TriangleAlert />}>
            {error.message}
          </InlineNotice>
        )}

        <Button
          type="submit"
          size="xl"
          className="w-full"
          loading={pending === 'form'}
          disabled={Boolean(pending)}
        >
          Sign in <ArrowRight />
        </Button>
      </form>

      {(demo.isPending || demo.data?.enabled) && (
        <section className="mt-10" aria-labelledby="demo-title">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <h2
              id="demo-title"
              className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground"
            >
              <Sparkles className="size-3.5" /> Try a demo persona
            </h2>
            <span className="h-px flex-1 bg-border" />
          </div>
          {demo.isPending ? (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {[
                { label: 'BookLeaf team', accounts: team, password: demo.data?.password?.admin },
                { label: 'Authors', accounts: authors, password: demo.data?.password?.author },
              ].map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    {group.label} · password{' '}
                    <span className="font-mono text-foreground">{group.password}</span>
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.accounts.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        disabled={Boolean(pending)}
                        onClick={() =>
                          void signIn({ email: account.email, password: group.password ?? '' }, account.email)
                        }
                        className={cn(
                          'group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition hover:-translate-y-px hover:border-input hover:shadow-page disabled:opacity-60',
                          pending === account.email && 'border-foreground/40',
                        )}
                      >
                        <Avatar name={account.displayName} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{account.displayName}</span>
                          <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {account.blurb}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
