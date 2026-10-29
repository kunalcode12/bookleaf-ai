import Link from 'next/link';
import { BookCover } from '@/components/book';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <BookCover title="The Missing Page" author="Error 404" size="lg" className="rotate-3" />
      <div>
        <h1 className="font-display text-5xl font-black">This page isn't in our catalogue.</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          The link may be old, or the page may have moved. Let's get you back to your books.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/">Take me home</Link>
      </Button>
    </main>
  );
}
