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
        <div className="absolute inset-0 bg-[linear-gradient(120deg,var(--background)_0%,var(--brand-secondary-soft)_42%,var(--background)_78%)] opacity-80 dark:opacity-55" />
        <div className="absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,var(--brand-wash),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:84px_84px] opacity-[0.16] dark:opacity-[0.08]" />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <div className="flex justify-end pb-4">
          <AuthThemeToggle />
        </div>

        <div className="grid flex-1 items-center justify-items-center gap-8 pb-8 pt-2 lg:grid-cols-[minmax(0,1.12fr)_minmax(420px,0.88fr)] lg:justify-items-stretch lg:gap-10 lg:pb-10">
          <section className="hidden min-w-0 lg:block">
            <InstitutionLockup className="mb-10 max-w-2xl" />
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">{brandConfig.institutionName}</p>
              <h1 className="mt-4 max-w-xl text-5xl font-semibold leading-[1.04] tracking-normal text-foreground">
                {brandConfig.productDescriptor} for faculty-led classrooms
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
                Create classroom material, narrated lessons, simulations, and private faculty
                workspaces in {brandConfig.productName}, a university-branded teaching environment.
              </p>
            </div>

            <div className="mt-10 grid max-w-xl grid-cols-3 overflow-hidden rounded-lg border border-border bg-card/80 shadow-[0_22px_60px_-42px_rgb(var(--brand-shadow))] backdrop-blur">
              <div className="border-r border-border px-4 py-4">
                <p className="text-[11px] font-semibold text-primary">Faculty</p>
                <p className="mt-1 text-sm font-medium text-foreground">Private workspace</p>
              </div>
              <div className="border-r border-border px-4 py-4">
                <p className="text-[11px] font-semibold text-primary">Create</p>
                <p className="mt-1 text-sm font-medium text-foreground">Lessons and slides</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[11px] font-semibold text-primary">Present</p>
                <p className="mt-1 text-sm font-medium text-foreground">Voice-enabled class</p>
              </div>
            </div>
          </section>

          <section className="w-full max-w-[456px] overflow-hidden rounded-lg border border-border bg-card/95 text-card-foreground shadow-[0_28px_90px_-56px_rgb(var(--brand-shadow))] backdrop-blur-xl">
            <div className="border-b border-border bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary))] px-5 py-4 text-white sm:px-6">
              <BrandWordmark
                size="sm"
                tone="onDark"
                showInstitution={false}
                markClassName="bg-white/12 ring-1 ring-white/20"
                textClassName="max-w-[290px]"
              />
            </div>

            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <InstitutionLockup className="mb-6 lg:hidden" variant="compact" />
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-px w-8 bg-primary" />
                  <p className="text-xs font-semibold text-primary">Faculty access</p>
                </div>
                <h2 className="text-2xl font-semibold tracking-normal text-card-foreground">
                  {title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p>
              </div>
              {children}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
