import Image from 'next/image';
import { Building2 } from 'lucide-react';
import { brandConfig } from '@/lib/branding/brand-config';
import { cn } from '@/lib/utils';

export function InstitutionLockup({
  className,
  variant = 'band',
}: {
  className?: string;
  variant?: 'band' | 'compact';
}) {
  if (variant === 'compact') {
    return (
      <div className={cn('flex min-w-0 items-center gap-3', className)}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/15 bg-card">
          <Image
            src={brandConfig.assets.productMark}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
            priority
          />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight text-foreground">
            {brandConfig.productName}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-primary">
            {brandConfig.productDescriptor}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {brandConfig.institutionName}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('relative overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      <div className="h-1 bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary),var(--brand-gold))] dark:hidden" />
      <div className="grid gap-4 px-4 py-4 sm:px-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-primary/15 bg-card shadow-[0_14px_30px_-24px_rgb(var(--brand-shadow))]">
              <Image
                src={brandConfig.assets.productMark}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-semibold leading-none text-foreground">
                {brandConfig.productName}
              </p>
              <p className="mt-1.5 text-sm font-semibold text-primary">
                {brandConfig.productDescriptor}
              </p>
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                {brandConfig.institutionFullName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2">
            <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <Image
              src={brandConfig.assets.institutionLogo}
              alt={brandConfig.institutionFullName}
              width={146}
              height={52}
              className="h-10 w-auto max-w-[160px] object-contain"
              priority
            />
          </div>
        </div>
        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">Supported by</p>
            <p className="mt-0.5 text-xs font-semibold leading-snug text-foreground">
              Centre for Research, Innovation and Entrepreneurship
            </p>
          </div>
          <Image
            src={brandConfig.assets.innovationCenterLogo}
            alt="CRiEYA"
            width={108}
            height={48}
            className="h-8 w-auto max-w-[120px] object-contain opacity-75"
            priority
          />
        </div>
      </div>
    </div>
  );
}
