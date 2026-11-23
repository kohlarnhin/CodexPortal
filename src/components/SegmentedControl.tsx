import { useLayoutEffect, useRef, useState, useCallback } from 'react';
import { cn } from '../lib/utils';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T | null;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[] | SegmentedOption<T>[];
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  label?: string;
}

export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  disabled,
  label,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number; visible: boolean }>({
    left: 0,
    width: 0,
    visible: false,
  });

  const updateIndicator = useCallback(() => {
    if (!value) {
      setIndicator(prev => ({ ...prev, visible: false }));
      return;
    }
    const currentBtn = buttonRefs.current.get(value);
    if (currentBtn) {
      setIndicator({
        left: currentBtn.offsetLeft,
        width: currentBtn.offsetWidth,
        visible: true,
      });
    }
  }, [value]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator, options]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateIndicator();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateIndicator]);

  const selectedIndex = options.findIndex(opt => opt.id === value);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn('segmented-control shrink-0', className)}
      onKeyDown={event => {
        const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
        if (disabled || !keys.includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : selectedIndex < 0
                ? step > 0
                  ? 0
                  : options.length - 1
                : (selectedIndex + step + options.length) % options.length;
        const nextOpt = options[next];
        if (nextOpt) {
          onChange(nextOpt.id);
          buttonRefs.current.get(nextOpt.id)?.focus();
        }
      }}
    >
      <span
        aria-hidden="true"
        className={cn('segmented-indicator', indicator.visible ? 'opacity-100' : 'opacity-0')}
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: `${indicator.width}px`,
        }}
      />

      {options.map((opt, index) => {
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            ref={el => {
              if (el) buttonRefs.current.set(opt.id, el);
              else buttonRefs.current.delete(opt.id);
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
            onClick={() => onChange(opt.id)}
            disabled={disabled}
            className={cn(
              'segmented-option outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
              size === 'sm' ? 'h-[26px] px-3 text-[12px]' : 'h-[29px] px-3.5 text-[12.5px]',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
