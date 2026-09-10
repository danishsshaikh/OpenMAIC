'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Atom, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type InteractiveModeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'aria-pressed' | 'children'
> &
  DataAttributes & {
    pressed: boolean;
    label: string;
    onPressedChange: (pressed: boolean) => void;
  };

export const InteractiveModeButton = forwardRef<HTMLButtonElement, InteractiveModeButtonProps>(
  function InteractiveModeButton(
    { pressed, label, onPressedChange, className, onClick, ...buttonProps },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        aria-pressed={pressed}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onPressedChange(!pressed);
        }}
        className={cn(
          'relative inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:active:scale-100',
          pressed
            ? 'border-primary/35 bg-primary text-primary-foreground shadow-[0_10px_22px_-18px_rgb(var(--brand-shadow)/0.42)] dark:shadow-none'
            : 'border-primary/30 bg-transparent text-primary hover:bg-primary/10 dark:hover:bg-primary/10',
          className,
        )}
      >
        {pressed && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-4px] rounded-full border border-primary/25 motion-safe:dark:animate-[interactive-mode-breathe_2s_ease-in-out_infinite]"
          />
        )}
        {pressed ? (
          <Check aria-hidden="true" className="relative z-10 size-3.5" />
        ) : (
          <Atom aria-hidden="true" className="relative z-10 size-3.5" />
        )}
        <span className="relative z-10">{label}</span>
      </button>
    );
  },
);
