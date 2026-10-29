'use client';

import type {
  AdminTicketDetail,
  AdminTicketListResponse,
  AdminTicketSort,
  AiDraft,
  AiHealth,
  AssistRequest,
  AssistResponse,
  AuthorDetail,
  AuthorListItem,
  AuthorTicketDetail,
  AuthorTicketListResponse,
  Book,
  BookListResponse,
  CreateTicketRequest,
  IncidentAlert,
  InsightsResponse,
  InternalNote,
  KbExample,
  KbSection,
  NotificationListResponse,
  QueueStats,
  SessionResponse,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UpdateKbSectionRequest,
  UpdateTicketRequest,
} from '@bookleaf/contracts';
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, qs } from './client';

// ─── Keys ───────────────────────────────────────────────────────────────────

export const keys = {
  session: ['session'] as const,
  notifications: ['notifications'] as const,
  myBooks: ['me', 'books'] as const,
  myBook: (id: string) => ['me', 'book', id] as const,
  myTickets: (status: string) => ['me', 'tickets', status] as const,
  myTicket: (ref: string) => ['me', 'ticket', ref] as const,
  queue: (filters: QueueFilters) => ['admin', 'tickets', filters] as const,
  stats: ['admin', 'stats'] as const,
  ticket: (ref: string) => ['admin', 'ticket', ref] as const,
  team: ['admin', 'team'] as const,
  authors: ['admin', 'authors'] as const,
  author: (id: string) => ['admin', 'author', id] as const,
  kbSections: ['admin', 'kb', 'sections'] as const,
  kbExamples: ['admin', 'kb', 'examples'] as const,
  insights: (days: number) => ['admin', 'insights', days] as const,
  alerts: ['admin', 'alerts'] as const,
  aiHealth: ['admin', 'ai-health'] as const,
};

// ─── Session & notifications ────────────────────────────────────────────────

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: ({ signal }) => api.get<SessionResponse>('/auth/session', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: ({ signal }) => api.get<NotificationListResponse>('/notifications', { signal }),
    staleTime: 30_000,
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.post<void>('/notifications/read', ids ? { ids } : {}),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}

// ─── Author: books & tickets ────────────────────────────────────────────────

export function useMyBooks() {
  return useQuery({
    queryKey: keys.myBooks,
    queryFn: ({ signal }) => api.get<BookListResponse>('/me/books', { signal }),
  });
}

export function useMyBook(id: string) {
  return useQuery({
    queryKey: keys.myBook(id),
    queryFn: ({ signal }) => api.get<Book>(`/me/books/${id}`, { signal }),
  });
}

export function useMyTickets(status: 'active' | TicketStatus | 'all' = 'all') {
  return useInfiniteQuery({
    queryKey: keys.myTickets(status),
    queryFn: ({ signal, pageParam }) =>
      api.get<AuthorTicketListResponse>(
        `/me/tickets${qs({ status: status === 'all' ? undefined : status, cursor: pageParam, limit: 20 })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  });
}

export function useMyTicket(ref: string) {
  return useQuery({
    queryKey: keys.myTicket(ref),
    queryFn: ({ signal }) => api.get<AuthorTicketDetail>(`/me/tickets/${ref}`, { signal }),
  });
}

export function useCreateTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateTicketRequest; idempotencyKey: string }) =>
      api.post<AuthorTicketDetail>('/me/tickets', body, { headers: { 'idempotency-key': idempotencyKey } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useAuthorReply(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; attachmentIds: string[]; idempotencyKey: string }) =>
      api.post<AuthorTicketDetail>(
        `/me/tickets/${ref}/messages`,
        { body: input.body, attachmentIds: input.attachmentIds },
        { headers: { 'idempotency-key': input.idempotencyKey } },
      ),
    onSuccess: (ticket) => {
      client.setQueryData(keys.myTicket(ref), ticket);
      void client.invalidateQueries({ queryKey: ['me', 'tickets'] });
    },
  });
}

export function useTicketFeedback(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { rating: 'up' | 'down'; comment?: string }) =>
      api.post<AuthorTicketDetail>(`/me/tickets/${ref}/feedback`, input),
    onSuccess: (ticket) => client.setQueryData(keys.myTicket(ref), ticket),
  });
}

export function useAskLeaf() {
  return useMutation({
    mutationFn: (input: AssistRequest) => api.post<AssistResponse>('/me/assist', input),
  });
}

export function useAssistFeedback() {
  return useMutation({
    mutationFn: (input: { messageId: string; helpful: boolean }) =>
      api.post<{ ok: true }>('/me/assist/feedback', input),
  });
}

// ─── Admin: queue & tickets ─────────────────────────────────────────────────

export interface QueueFilters {
  status: TicketStatus[];
  category: TicketCategory[];
  priority: TicketPriority[];
  assignee: string | null;
  q: string;
  sort: AdminTicketSort;
  flag: string | null;
  sla: string | null;
  createdFrom: string | null;
  createdTo: string | null;
}

export function useQueue(filters: QueueFilters) {
  return useInfiniteQuery({
    queryKey: keys.queue(filters),
    queryFn: ({ signal, pageParam }) =>
      api.get<AdminTicketListResponse>(
        `/admin/tickets${qs({
          status: filters.status,
          category: filters.category,
          priority: filters.priority,
          assignee: filters.assignee,
          q: filters.q.trim() || undefined,
          sort: filters.sort,
          flag: filters.flag,
          sla: filters.sla,
          createdFrom: filters.createdFrom,
          createdTo: filters.createdTo,
          cursor: pageParam,
          limit: 30,
        })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useQueueStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: ({ signal }) => api.get<QueueStats>('/admin/tickets/stats', { signal }),
    refetchInterval: 60_000,
  });
}

export function useAdminTicket(ref: string) {
  return useQuery({
    queryKey: keys.ticket(ref),
    queryFn: ({ signal }) => api.get<AdminTicketDetail>(`/admin/tickets/${ref}`, { signal }),
  });
}

function onTicketChanged(client: QueryClient, ref: string, ticket: AdminTicketDetail) {
  client.setQueryData(keys.ticket(ref), ticket);
  void client.invalidateQueries({ queryKey: ['admin', 'tickets'] });
  void client.invalidateQueries({ queryKey: keys.stats });
}

export function useUpdateTicket(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ patch, version }: { patch: UpdateTicketRequest; version: number }) =>
      api.patch<AdminTicketDetail>(`/admin/tickets/${ref}`, patch, {
        headers: { 'if-match': `W/"${version}"` },
      }),
    onSuccess: (ticket) => onTicketChanged(client, ref, ticket),
  });
}

export function useAssignTicket(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { assigneeId: string | null; force?: boolean }) =>
      api.put<AdminTicketDetail>(`/admin/tickets/${ref}/assignee`, input),
    onSuccess: (ticket) => onTicketChanged(client, ref, ticket),
  });
}

export function useAdminReply(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      body: string;
      resolve: boolean;
      draftId?: string;
      attachmentIds: string[];
      idempotencyKey: string;
    }) =>
      api.post<AdminTicketDetail>(
        `/admin/tickets/${ref}/messages`,
        {
          body: input.body,
          resolve: input.resolve,
          draftId: input.draftId,
          attachmentIds: input.attachmentIds,
        },
        { headers: { 'idempotency-key': input.idempotencyKey } },
      ),
    onSuccess: (ticket) => onTicketChanged(client, ref, ticket),
  });
}

export function useAddNote(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<InternalNote>(`/admin/tickets/${ref}/notes`, { body }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.ticket(ref) }),
  });
}

export function useRetriage(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>(`/admin/tickets/${ref}/triage`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.ticket(ref) }),
  });
}

export function useLatestDraft(ref: string, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.ticket(ref), 'draft'],
    queryFn: ({ signal }) => api.get<{ draft: AiDraft | null }>(`/admin/tickets/${ref}/draft`, { signal }),
    enabled,
  });
}

export function useTeam() {
  return useQuery({
    queryKey: keys.team,
    queryFn: ({ signal }) =>
      api.get<{ data: Array<{ id: string; displayName: string; title: string | null }> }>('/admin/team', {
        signal,
      }),
    staleTime: 10 * 60_000,
  });
}

export function useAiHealth() {
  return useQuery({
    queryKey: keys.aiHealth,
    queryFn: ({ signal }) => api.get<AiHealth>('/admin/ai/health', { signal }),
    refetchInterval: 60_000,
  });
}

// ─── Admin: operations ──────────────────────────────────────────────────────

export function useAlerts() {
  return useQuery({
    queryKey: keys.alerts,
    queryFn: ({ signal }) => api.get<{ data: IncidentAlert[] }>('/admin/alerts', { signal }),
  });
}

export function useUpdateAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'acknowledged' | 'resolved' }) =>
      api.patch<{ ok: true }>(`/admin/alerts/${id}`, { status }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.alerts }),
  });
}

export function useAuthors() {
  return useQuery({
    queryKey: keys.authors,
    queryFn: ({ signal }) => api.get<{ data: AuthorListItem[] }>('/admin/authors', { signal }),
  });
}

export function useAuthor(id: string) {
  return useQuery({
    queryKey: keys.author(id),
    queryFn: ({ signal }) => api.get<AuthorDetail>(`/admin/authors/${id}`, { signal }),
  });
}

export function useInsights(days: number) {
  return useQuery({
    queryKey: keys.insights(days),
    queryFn: ({ signal }) => api.get<InsightsResponse>(`/admin/insights${qs({ days })}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useKbSections() {
  return useQuery({
    queryKey: keys.kbSections,
    queryFn: ({ signal }) => api.get<{ data: KbSection[] }>('/admin/knowledge-base/sections', { signal }),
  });
}

export function useUpdateKbSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateKbSectionRequest }) =>
      api.patch<KbSection>(`/admin/knowledge-base/sections/${id}`, patch),
    onSuccess: (section) => {
      client.setQueryData<{ data: KbSection[] }>(keys.kbSections, (old) =>
        old ? { data: old.data.map((s) => (s.id === section.id ? section : s)) } : old,
      );
    },
  });
}

export function useKbExamples() {
  return useQuery({
    queryKey: keys.kbExamples,
    queryFn: ({ signal }) => api.get<{ data: KbExample[] }>('/admin/knowledge-base/examples', { signal }),
  });
}

export function useSetExampleActive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<{ ok: true }>(`/admin/knowledge-base/examples/${id}`, { isActive }),
    onMutate: async ({ id, isActive }) => {
      await client.cancelQueries({ queryKey: keys.kbExamples });
      const previous = client.getQueryData<{ data: KbExample[] }>(keys.kbExamples);
      client.setQueryData<{ data: KbExample[] }>(keys.kbExamples, (old) =>
        old ? { data: old.data.map((e) => (e.id === id ? { ...e, isActive } : e)) } : old,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(keys.kbExamples, context.previous);
    },
  });
}

export function usePromoteReply() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; guidance?: string }) =>
      api.post<KbExample>('/admin/knowledge-base/examples', input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.kbExamples }),
  });
}
