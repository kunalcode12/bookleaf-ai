'use client';

import {
  type KbExample,
  type KbSection,
  LIMITS,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  type TicketCategory,
} from '@bookleaf/contracts';
import { Check, CircleDashed, Eye, EyeOff, LibraryBig, Quote, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LeafGlyph } from '@/components/brand';
import { EmptyState, ErrorState, InlineNotice } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import {
  useAiHealth,
  useKbExamples,
  useKbSections,
  useSetExampleActive,
  useUpdateKbSection,
} from '@/lib/api/queries';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';

function SectionEditor({ section }: { section: KbSection }) {
  const update = useUpdateKbSection();
  const health = useAiHealth();
  const embeddingsOn = health.data?.embeddings.configured;
  const [title, setTitle] = useState(section.title);
  const [body, setBody] = useState(section.body);
  const [categories, setCategories] = useState<TicketCategory[]>(section.categories);

  useEffect(() => {
    setTitle(section.title);
    setBody(section.body);
    setCategories(section.categories);
  }, [section]);

  const dirty =
    title !== section.title ||
    body !== section.body ||
    JSON.stringify(categories) !== JSON.stringify(section.categories);

  const save = () =>
    update.mutate(
      { id: section.id, patch: { title, body, categories } },
      {
        onSuccess: (s) =>
          toast.success(`Saved as version ${s.version}`, {
            description: 'Leaf uses the new text from its next reply.',
          }),
        onError: (e) =>
          toast.error('Not saved', {
            description: isApiError(e) ? (e.fieldErrors[0]?.message ?? e.message) : undefined,
          }),
      },
    );

  const toggle = (patch: { alwaysInclude?: boolean; isPublished?: boolean }) =>
    update.mutate(
      { id: section.id, patch },
      { onError: (e) => toast.error('Not saved', { description: isApiError(e) ? e.message : undefined }) },
    );

  return (
    <div className="paper space-y-6 rounded-2xl p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">v{section.version}</Badge>
        <Badge tone="outline">~{section.tokenEstimate} tokens</Badge>
        {section.hasEmbedding ? (
          <Badge tone="leaf">
            <LeafGlyph /> Indexed for semantic retrieval
          </Badge>
        ) : embeddingsOn === false ? (
          <Tooltip content="No embedding model is configured, so Leaf picks policies by ticket category.">
            <Badge tone="outline">Category retrieval</Badge>
          </Tooltip>
        ) : (
          <Badge tone="outline">
            <CircleDashed /> Indexing…
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {section.updatedBy ? `Edited by ${section.updatedBy.displayName} · ` : ''}
          {ago(section.updatedAt)}
        </span>
      </div>
      <Field id="kb-title" label="Title">
        <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </Field>
      <Field
        id="kb-body"
        label="Policy text"
        hint="Leaf quotes this word for word. Keep each rule on its own line."
        counter={`${body.length}/${LIMITS.kbSectionBody.max}`}
      >
        <Textarea
          id="kb-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          maxLength={LIMITS.kbSectionBody.max}
          className="font-mono text-[13px]"
        />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Used for tickets about</p>
        <div className="flex flex-wrap gap-1.5">
          {TICKET_CATEGORIES.map((c) => {
            const on = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setCategories(on ? categories.filter((x) => x !== c) : [...categories, c])}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition',
                  on ? 'border-leaf bg-leaf-soft text-leaf-ink' : 'bg-card hover:border-input',
                )}
              >
                {on && <Check className="size-3" />}
                {TICKET_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border p-3.5">
          <Switch
            id={`${section.id}-always`}
            checked={section.alwaysInclude}
            onCheckedChange={(alwaysInclude) => toggle({ alwaysInclude })}
            disabled={update.isPending}
          />
          <label htmlFor={`${section.id}-always`} className="cursor-pointer text-sm">
            <span className="block font-semibold">Include in every draft</span>
            <span className="text-muted-foreground">For rules that apply whatever the topic.</span>
          </label>
        </div>
        <div className="flex items-start gap-3 rounded-xl border p-3.5">
          <Switch
            id={`${section.id}-published`}
            checked={section.isPublished}
            onCheckedChange={(isPublished) => toggle({ isPublished })}
            disabled={update.isPending}
          />
          <label htmlFor={`${section.id}-published`} className="cursor-pointer text-sm">
            <span className="block font-semibold">Authors can see it</span>
            <span className="text-muted-foreground">Ask Leaf may quote it to authors.</span>
          </label>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t pt-5">
        {dirty && <span className="text-xs font-semibold text-warning">Unsaved changes</span>}
        <Button
          variant="outline"
          disabled={!dirty || update.isPending}
          onClick={() => {
            setTitle(section.title);
            setBody(section.body);
            setCategories(section.categories);
          }}
        >
          Discard
        </Button>
        <Button onClick={save} loading={update.isPending} disabled={!dirty}>
          <Save /> Save new version
        </Button>
      </div>
    </div>
  );
}

function ExampleCard({ example }: { example: KbExample }) {
  const setActive = useSetExampleActive();
  return (
    <article className={cn('paper space-y-3 rounded-2xl p-5 transition', !example.isActive && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <Badge tone="neutral" size="sm">
          {TICKET_CATEGORY_LABELS[example.category]}
        </Badge>
        <Badge tone={example.source === 'promoted' ? 'leaf' : 'outline'} size="sm">
          {example.source === 'promoted'
            ? `From a real reply${example.createdBy ? ` by ${example.createdBy.displayName}` : ''}`
            : 'Policy document'}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip content={example.isActive ? 'Leaf learns from this example' : 'Leaf ignores this example'}>
            <span className="text-muted-foreground">
              {example.isActive ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </span>
          </Tooltip>
          <Switch
            checked={example.isActive}
            onCheckedChange={(isActive) => setActive.mutate({ id: example.id, isActive })}
            aria-label="Use this example"
          />
        </div>
      </div>
      <p className="flex gap-2 font-display text-lg font-bold leading-snug">
        <Quote className="mt-1 size-4 shrink-0 text-muted-foreground" />
        {example.query}
      </p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{example.guidance}</p>
      {example.sampleReply && (
        <details className="rounded-xl bg-muted/50 p-3 text-[13px]">
          <summary className="cursor-pointer font-semibold">Sample reply (anonymised)</summary>
          <p className="mt-2 whitespace-pre-line leading-relaxed">{example.sampleReply}</p>
        </details>
      )}
    </article>
  );
}

export default function KnowledgePage() {
  const sections = useKbSections();
  const examples = useKbExamples();
  const [selected, setSelected] = useState<string | null>(null);
  const current = sections.data?.data.find((s) => s.id === selected) ?? sections.data?.data[0];

  return (
    <div className="space-y-8">
      <title>Knowledge base · BookLeaf desk</title>
      <PageHeader
        eyebrow="Knowledge base"
        title="What Leaf knows"
        description="The policies Leaf answers from and the examples that set its tone. Edits are versioned and take effect immediately. No deploy, no retraining."
      />
      <Tabs defaultValue="policies">
        <TabsList>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="examples">Tone examples</TabsTrigger>
        </TabsList>
        <TabsContent value="policies" className="mt-6">
          {sections.isError ? (
            <ErrorState error={sections.error} onRetry={() => void sections.refetch()} />
          ) : !sections.data ? (
            <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
              <Skeleton className="h-96 rounded-2xl" />
              <Skeleton className="h-[34rem] rounded-2xl" />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[18rem_1fr] lg:items-start">
              <nav className="paper rounded-2xl p-2" aria-label="Policy sections">
                {sections.data.data.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition',
                      current?.id === s.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {!s.isPublished && <EyeOff className="size-3.5 shrink-0 opacity-60" />}
                    <span className="text-[11px] font-semibold tabular-nums opacity-60">v{s.version}</span>
                  </button>
                ))}
              </nav>
              {current ? (
                <SectionEditor key={current.id} section={current} />
              ) : (
                <EmptyState icon={<LibraryBig />} title="No policies yet" />
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="examples" className="mt-6 space-y-5">
          <InlineNotice tone="leaf" icon={<LeafGlyph />} title="How Leaf learns BookLeaf's voice">
            Leaf picks the closest examples for each ticket. Add more by clicking "Teach Leaf with this reply"
            on any reply you're proud of. Names, amounts and dates are stripped first.
          </InlineNotice>
          {examples.isError ? (
            <ErrorState error={examples.error} onRetry={() => void examples.refetch()} />
          ) : !examples.data ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {examples.data.data.map((e) => (
                <ExampleCard key={e.id} example={e} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
