import React, { useEffect, useRef, useState, useCallback } from 'react';
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
}

export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  disabled,
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

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator, options]);

  // 监听容器尺寸变化（如字体加载或窗口变化），保证指示条对齐
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateIndicator();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateIndicator]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative inline-flex items-center rounded-lg bg-neutral-100/90 p-1 border border-neutral-200/70 shadow-2xs select-none shrink-0',
        className
      )}
    >
      {/* 滑动白色胶囊高亮条 */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1 bottom-1 left-0 rounded-md bg-white shadow-2xs pointer-events-none transition-all duration-200 ease-out',
          indicator.visible ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: `${indicator.width}px`,
        }}
      />

      {options.map(opt => {
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            ref={el => {
              if (el) buttonRefs.current.set(opt.id, el);
              else buttonRefs.current.delete(opt.id);
            }}
            type="button"
            onClick={() => onChange(opt.id)}
            disabled={disabled}
            className={cn(
              'relative z-10 rounded-md font-medium transition-colors cursor-pointer select-none whitespace-nowrap',
              size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[12.5px]',
              isActive ? 'text-neutral-900 font-semibold' : 'text-neutral-500 hover:text-neutral-900',
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
