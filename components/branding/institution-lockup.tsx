import Image from 'next/image';
import { brandConfig } from '@/lib/branding/brand-config';
import { cn } from '@/lib/utils';

export function InstitutionLockup({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-5 rounded-lg border border-border bg-background/75 px-4 py-3',
        className,
      )}
    >
      <Image
        src={brandConfig.assets.institutionLogo}
        alt={brandConfig.institutionFullName}
        width={188}
        height={68}
        className="h-12 w-auto max-w-[54%] object-contain sm:h-13"
        priority
      />
      <div className="h-9 w-px bg-border" />
      <Image
        src={brandConfig.assets.innovationCenterLogo}
        alt="CRiEYA"
        width={132}
        height={58}
        className="h-11 w-auto max-w-[38%] object-contain sm:h-12"
        priority
      />
    </div>
  );
}
