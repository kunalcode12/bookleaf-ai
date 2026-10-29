import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/shell/admin-shell';

export const metadata: Metadata = { title: { default: 'Support desk', template: '%s · BookLeaf desk' } };

export default function DeskLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
