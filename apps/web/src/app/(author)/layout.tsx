import type { ReactNode } from 'react';
import { AuthorShell } from '@/components/shell/author-shell';

export default function AuthorLayout({ children }: { children: ReactNode }) {
  return <AuthorShell>{children}</AuthorShell>;
}
