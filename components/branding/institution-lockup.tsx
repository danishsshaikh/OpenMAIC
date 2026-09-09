import Image from 'next/image';
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
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary shadow-[0_14px_30px_-20px_rgb(var(--brand-shadow))]">
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
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-[var(--brand-band)] shadow-[0_18px_46px_-34px_rgb(var(--brand-shadow))]',
        className,
      )}
    >
      <div className="h-1 bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary),var(--brand-gold))]" />
      <div className="grid gap-4 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-primary shadow-[0_16px_34px_-22px_rgb(var(--brand-shadow))]">
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
            <p className="text-2xl font-semibold leading-none text-[var(--brand-band-foreground)]">
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
