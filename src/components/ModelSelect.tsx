import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';
import Input from './ui/input';

interface ModelSelectProps {
  id: string;
  describedBy?: string;
  value: string;
  onChange: (value: string) => void;
  models: readonly string[];
  disabled?: boolean;
  className?: string;
}

export default function ModelSelect({ id, describedBy, value, onChange, models, disabled, className }: ModelSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLDivElement>(null);
  const open = isOpen && !disabled;
  const listId = `${id}-options`;
  const customModel = value && !models.includes(value) ? value : null;
  const options = [
    { value: '', label: '使用默认模型', custom: false },
    ...models
      .filter(model => model.toLowerCase().includes(query.toLowerCase()))
      .map(model => ({ value: model, label: model, custom: false })),
    ...(customModel ? [{ value: customModel, label: customModel, custom: true }] : []),
  ];
  const activeIndex = options.findIndex(option => option.value === activeValue);

  const openMenu = () => {
    setQuery('');
    setActiveValue(value);
    setIsOpen(true);
  };

  const selectModel = (model: string) => {
    onChange(model);
    inputRef.current?.focus({ preventScroll: true });
    setIsOpen(false);
  };

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  // 浮层放到页面根部，避免配置卡片的滚动区域裁切选项。
  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const desiredHeight = Math.min(360, options.length * 34 + 76);
      const showBelow = below >= desiredHeight || below >= above;
      const width = Math.min(rect.width, window.innerWidth - margin * 2);
      setPosition({
        width,
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: showBelow ? rect.bottom + gap : undefined,
        bottom: showBelow ? undefined : window.innerHeight - rect.top + gap,
        maxHeight: Math.max(0, Math.min(360, showBelow ? below : above)),
      });
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node
        && !containerRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open, options.length]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const option = activeOptionRef.current;
    if (!open || !list || !option) return;
    const listRect = list.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < listRect.top) list.scrollTop -= listRect.top - optionRect.top;
    else if (optionRect.bottom > listRect.bottom) list.scrollTop += optionRect.bottom - listRect.bottom;
  }, [open, activeValue, position.maxHeight]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)
          && !menuRef.current?.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-describedby={describedBy}
        value={value}
        onFocus={openMenu}
        onClick={() => { if (!open) openMenu(); }}
        onChange={event => {
          const model = event.target.value.trim();
          onChange(model);
          setQuery(model);
          setActiveValue(null);
          setIsOpen(true);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            const next = activeIndex < 0
              ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            setActiveValue(options[next].value);
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (activeIndex >= 0) selectModel(options[activeIndex].value);
            else setIsOpen(false);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
          } else if (event.key === 'Tab') {
            setIsOpen(false);
          }
        }}
        disabled={disabled}
        placeholder="使用默认模型"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          'h-8 pr-9 font-medium text-neutral-900 hover:border-neutral-300 focus-visible:border-neutral-400 focus-visible:ring-neutral-900/5',
          open && 'border-neutral-400 ring-2 ring-neutral-900/5',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={open ? '收起模型选项' : '展开模型选项'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          inputRef.current?.focus({ preventScroll: true });
          if (open) setIsOpen(false);
          else openMenu();
        }}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={position}
          onMouseDown={event => event.preventDefault()}
          className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-neutral-200/90 bg-white shadow-[0_8px_30px_-8px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.04)] animate-fade-in motion-reduce:animate-none"
        >
          <div className="flex shrink-0 items-center justify-between px-3.5 pt-2.5 pb-1.5 text-[10.5px] text-neutral-400" aria-hidden="true">
            <span className="font-medium">{query ? '匹配模型' : '选择模型'}</span>
            <span>支持自定义</span>
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="模型选项" className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
            {options.map((option, index) => (
              <div
                key={option.value}
                ref={activeValue === option.value ? activeOptionRef : undefined}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={value === option.value}
                onMouseEnter={() => setActiveValue(option.value)}
                onClick={() => selectModel(option.value)}
                className={cn(
                  'flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors',
                  activeValue === option.value ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50',
                  value === option.value && 'font-medium text-neutral-900',
                  index === 0 && 'mb-1',
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                {option.custom && <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal text-neutral-500">自定义</span>}
                <span className="flex w-3.5 shrink-0 items-center justify-center">
                  {value === option.value && (
                    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-neutral-100 bg-neutral-50/70 px-3.5 py-2 text-[10.5px] text-neutral-400" aria-hidden="true">
            ↑ ↓ 选择 <span className="mx-1.5 text-neutral-300">·</span> Enter 确认 <span className="mx-1.5 text-neutral-300">·</span> Esc 收起
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
