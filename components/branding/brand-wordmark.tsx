import Image from 'next/image';
import { brandConfig } from '@/lib/branding/brand-config';
import { cn } from '@/lib/utils';

interface BrandWordmarkProps {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  showInstitution?: boolean;
}

export function BrandWordmark({
  className,
  markClassName,
  textClassName,
  showInstitution = true,
}: BrandWordmarkProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <Image
        src={brandConfig.assets.productMark}
        alt=""
        width={36}
        height={36}
        className={cn('h-8 w-8 shrink-0', markClassName)}
        priority
      />
      <div className={cn('min-w-0 leading-none', textClassName)}>
        <div className="truncate text-sm font-semibold text-foreground">
          {brandConfig.productName}
        </div>
        {showInstitution && (
          <div className="mt-1 truncate text-[10px] font-medium text-muted-foreground">
            {brandConfig.institutionName}
          </div>
        )}
      </div>
    </div>
  );
}
