import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BookCover } from '@/components/book';
import { BookLeafLogo, LeafGlyph } from '@/components/brand';
import { Skeleton } from '@/components/ui/misc';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#171511] text-[#f1e9da] lg:flex lg:flex-col lg:justify-between lg:p-12 dark:bg-[#0c0b09]">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(700px 400px at 20% 10%, rgb(212 127 34 / 0.22), transparent 60%), radial-gradient(600px 380px at 90% 90%, rgb(45 106 77 / 0.35), transparent 60%)',
          }}
        />
        <div className="relative [&_.fill-primary]:fill-[#f1e9da] [&_.fill-primary-foreground\/90]:fill-[#171511]">
          <BookLeafLogo subtitle="Author support" className="[&_.text-muted-foreground]:text-[#a69c8b]" />
        </div>

        <div className="relative">
          <h2 className="max-w-xl font-display text-6xl font-black leading-[0.92] xl:text-7xl">
            Every author deserves a straight answer.
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-[#c9bfae]">
            Your books, your royalties and every question, in one place. Answered by the BookLeaf team, with
            <span className="mx-1.5 inline-flex translate-y-0.5 items-center gap-1 rounded-full bg-[#7bc499]/15 px-2 py-0.5 text-sm font-bold text-[#a9dcbd]">
              <LeafGlyph className="size-3.5" /> Leaf
            </span>
            at their side.
          </p>
        </div>

        <div className="relative flex items-end gap-5">
          <BookCover title="Whispers of the Ganges" author="Priya Sharma" size="lg" className="-rotate-6" />
          <BookCover title="Code & Karma" author="Rohit Kapoor" size="xl" className="z-10 -mb-3" />
          <BookCover title="Durga’s Daughters" author="Diya Chatterjee" size="lg" className="rotate-6" />
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <BookLeafLogo subtitle="Author support" />
          </div>
          <Suspense
            fallback={
              <div className="space-y-4">
                <Skeleton className="h-12 w-40" />
                <Skeleton className="h-11" />
                <Skeleton className="h-11" />
                <Skeleton className="h-14" />
              </div>
            }
          >
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
