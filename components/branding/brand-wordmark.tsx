import Image from 'next/image';
import { brandConfig } from '@/lib/branding/brand-config';
import { cn } from '@/lib/utils';

interface BrandWordmarkProps {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  showDescriptor?: boolean;
  showInstitution?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'onDark';
}

export function BrandWordmark({
  className,
  markClassName,
  textClassName,
  showDescriptor = true,
  showInstitution = false,
  size = 'md',
  tone = 'default',
}: BrandWordmarkProps) {
  const sizeClasses = {
    sm: {
      root: 'gap-2',
      mark: 'h-7 w-7 rounded-md',
      product: 'text-sm',
      descriptor: 'text-[9px]',
      institution: 'text-[9px]',
    },
    md: {
      root: 'gap-2.5',
      mark: 'h-9 w-9 rounded-md',
      product: 'text-base',
      descriptor: 'text-[11px]',
      institution: 'text-[10px]',
    },
    lg: {
      root: 'gap-3',
      mark: 'h-12 w-12 rounded-lg',
      product: 'text-2xl sm:text-3xl',
      descriptor: 'text-xs sm:text-sm',
      institution: 'text-[11px] sm:text-xs',
    },
  }[size];
  const onDark = tone === 'onDark';

  return (
    <div className={cn('flex min-w-0 items-center', sizeClasses.root, className)}>
      <div
        className={cn(
          'grid shrink-0 place-items-center border border-primary/15 bg-card shadow-[0_10px_24px_-18px_rgb(var(--brand-shadow)/0.28)]',
          sizeClasses.mark,
          markClassName,
        )}
      >
        <Image
          src={brandConfig.assets.productMark}
          alt=""
          width={40}
          height={40}
          className="h-full w-full object-contain"
          priority
        />
      </div>
      <div className={cn('min-w-0 leading-none', textClassName)}>
        <div
          className={cn(
            'truncate font-semibold tracking-normal',
            sizeClasses.product,
            onDark ? 'text-white' : 'text-foreground',
          )}
        >
          {brandConfig.productName}
        </div>
        {showDescriptor && (
          <div
            className={cn(
              'mt-1 truncate font-semibold tracking-normal',
              sizeClasses.descriptor,
              onDark ? 'text-white/78' : 'text-primary',
            )}
          >
            {brandConfig.productDescriptor}
          </div>
        )}
        {showInstitution && (
          <div
            className={cn(
              'mt-1 truncate font-medium tracking-normal',
              sizeClasses.institution,
              onDark ? 'text-white/68' : 'text-muted-foreground',
            )}
          >
            {brandConfig.institutionName}
          </div>
        )}
      </div>
    </div>
  );
}
