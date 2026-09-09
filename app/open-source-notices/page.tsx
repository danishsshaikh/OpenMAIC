import Link from 'next/link';
import { OpenSourceNotices } from '@/components/branding/open-source-notices';
import { BrandWordmark } from '@/components/branding/brand-wordmark';

export default function OpenSourceNoticesPage() {
  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/70 bg-card/80 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <BrandWordmark />
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Back to app
          </Link>
        </div>
      </header>
      <OpenSourceNotices />
    </main>
  );
}
