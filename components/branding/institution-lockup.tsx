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
        <Image
          src={brandConfig.assets.institutionLogo}
          alt={brandConfig.institutionFullName}
          width={150}
          height={54}
          className="h-9 w-auto max-w-[58%] object-contain"
          priority
        />
        <div className="h-8 w-px shrink-0 bg-border" />
        <Image
          src={brandConfig.assets.innovationCenterLogo}
          alt="CRiEYA"
          width={108}
          height={48}
          className="h-8 w-auto max-w-[34%] object-contain"
          priority
        />
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
      <div className="flex items-center gap-4 px-4 py-3 sm:gap-5 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center">
          <Image
            src={brandConfig.assets.institutionLogo}
            alt={brandConfig.institutionFullName}
            width={188}
            height={68}
            className="h-10 w-auto max-w-full object-contain sm:h-11"
            priority
          />
        </div>
        <div className="h-10 w-px shrink-0 bg-border" />
        <div className="hidden min-w-0 flex-1 sm:block">
          <p className="text-[11px] font-semibold uppercase tracking-normal text-primary">
            Centre for research, innovation and entrepreneurship
          </p>
          <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
            University-backed classroom AI platform
          </p>
        </div>
        <Image
          src={brandConfig.assets.innovationCenterLogo}
          alt="CRiEYA"
          width={132}
          height={58}
          className="h-9 w-auto max-w-[34%] shrink-0 object-contain sm:h-10 sm:max-w-[22%]"
          priority
        />
      </div>
    </div>
  );
}
