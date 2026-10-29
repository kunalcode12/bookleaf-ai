'use client';

import type { Notification, SessionUser, UserRole } from '@bookleaf/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Inbox, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, Skeleton } from '@/components/ui/misc';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@/components/ui/primitives';
import { api } from '@/lib/api/client';
import { useMarkNotificationsRead, useNotifications, useSession } from '@/lib/api/queries';
import { ago } from '@/lib/format';
import { useRealtimeStatus } from '@/lib/realtime';
import { cn } from '@/lib/utils';

/** Renders children only for a signed-in user of the expected role; otherwise routes them home. */
export function SessionGate({
  audience,
  children,
  fallback,
}: {
  audience: UserRole;
  children: (user: SessionUser) => ReactNode;
  fallback: ReactNode;
}) {
  const router = useRouter();
  const session = useSession();
  const user = session.data?.user;
  const wrongRole = user && user.role !== audience;

  useEffect(() => {
    if (wrongRole) router.replace(user.role === 'admin' ? '/desk' : '/home');
  }, [wrongRole, router, user?.role]);

  if (!user || wrongRole) return <>{fallback}</>;
  return <>{children(user)}</>;
}

export function useSignOut() {
  const router = useRouter();
  const client = useQueryClient();
  return async () => {
    await api.post('/auth/logout').catch(() => undefined);
    client.clear();
    router.replace('/login');
  };
}

export function UserMenu({ user }: { user: SessionUser }) {
  const signOut = useSignOut();
  const { theme, setTheme } = useTheme();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-full p-0.5 pr-0.5 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:pr-3"
          aria-label="Account menu"
        >
          <Avatar name={user.displayName} />
          <span className="hidden text-left text-sm leading-tight sm:block">
            <span className="block font-semibold">{user.displayName.split(' ')[0]}</span>
          </span>
        </button>
      </MenuTrigger>
      <MenuContent className="w-64">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar name={user.displayName} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.title ?? user.email}</p>
          </div>
        </div>
        <MenuSeparator />
        <MenuLabel>Appearance</MenuLabel>
        {(
          [
            ['light', 'Paper (light)', Sun],
            ['dark', 'Midnight Library (dark)', Moon],
            ['system', 'Match my device', Monitor],
          ] as const
        ).map(([value, label, Icon]) => (
          <MenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className={cn(theme === value && 'bg-muted')}
          >
            <Icon /> {label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function NotificationsMenu({ hrefFor }: { hrefFor: (n: Notification) => string | null }) {
  const router = useRouter();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          className="relative"
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground ring-2 ring-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-display text-lg font-extrabold">Notifications</p>
          {unread > 0 && (
            <Button variant="link" size="sm" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[26rem] overflow-y-auto scrollbar-thin">
          {notifications.isPending ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : (notifications.data?.data.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="size-6" />
              You're all caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.data?.data.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate([n.id]);
                      const href = hrefFor(n);
                      setOpen(false);
                      if (href) router.push(href);
                    }}
                    className="flex w-full gap-3 px-4 py-3 text-left transition hover:bg-muted/60"
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : 'bg-accent',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug">{n.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                        {n.body}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function RealtimeDot({ className }: { className?: string }) {
  const { status } = useRealtimeStatus();
  const label =
    status === 'live'
      ? 'Live: updates appear instantly'
      : status === 'polling'
        ? 'Live connection unavailable: checking for updates every 20 seconds'
        : 'Connecting…';
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground',
          className,
        )}
      >
        <span className="relative flex size-2">
          {status === 'live' && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-leaf/60" />
          )}
          <span
            className={cn(
              'relative inline-flex size-2 rounded-full',
              status === 'live' ? 'bg-leaf' : status === 'polling' ? 'bg-warning' : 'bg-muted-foreground/50',
            )}
          />
        </span>
        <span className="hidden md:inline">
          {status === 'live' ? 'Live' : status === 'polling' ? 'Syncing' : '…'}
        </span>
      </span>
    </Tooltip>
  );
}

export function FullPageLoader() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-5 py-10">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-14 w-2/3" />
      <div className="grid gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
