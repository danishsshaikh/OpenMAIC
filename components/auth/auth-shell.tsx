import type { ReactNode } from 'react';
import { AuthThemeToggle } from '@/components/auth/auth-theme-toggle';
import { BrandWordmark } from '@/components/branding/brand-wordmark';
import { InstitutionLockup } from '@/components/branding/institution-lockup';
import { brandConfig } from '@/lib/branding/brand-config';

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.18] dark:opacity-[0.10]" />
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/12 to-transparent" />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <div className="flex justify-end">
          <AuthThemeToggle />
        </div>

        <div className="grid flex-1 items-center justify-items-center gap-8 py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(400px,0.85fr)] lg:justify-items-stretch lg:gap-14 lg:py-10">
          <section className="hidden max-w-2xl lg:block">
            <BrandWordmark className="mb-8" markClassName="h-10 w-10" />
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-normal text-foreground sm:text-5xl">
              Faculty AI classroom platform
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              Create, teach, and present AI-assisted classroom experiences for{' '}
              {brandConfig.institutionName} faculty, including slides, quizzes, simulations, and
              Teaching Voice narration.
            </p>

            <div className="mt-10 hidden max-w-xl rounded-lg border border-border bg-card/70 p-4 shadow-xs lg:block">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="rounded-lg border border-border bg-background/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Source</p>
                  <p className="mt-1 text-sm font-medium">Course material</p>
                </div>
                <div className="h-px w-12 bg-border" />
                <div className="rounded-lg border border-border bg-background/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {brandConfig.shortName}
                  </p>
                  <p className="mt-1 text-sm font-medium">Classroom scenes</p>
                </div>
              </div>
              <div className="mx-auto h-8 w-px bg-border" />
              <div className="mx-auto w-[74%] rounded-lg border border-primary/25 bg-primary/10 p-3 text-center">
                <p className="text-xs font-medium text-primary">Teaching voice ready</p>
              </div>
            </div>
          </section>

          <section className="w-full max-w-[440px] rounded-lg border border-border bg-card/90 p-5 text-card-foreground shadow-xs sm:p-6">
            <InstitutionLockup className="mb-6" />
            <div className="mb-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground lg:hidden">
                {brandConfig.productName}
              </p>
              <h2 className="text-2xl font-semibold tracking-normal text-card-foreground">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p>
            </div>
            {children}
          </section>
        </div>
      </div>
    </main>
  );
}
