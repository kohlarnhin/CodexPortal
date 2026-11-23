import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
}

interface ToastOptions {
  title?: string;
  /** 自动关闭时长（毫秒），0 表示不自动关闭 */
  duration?: number;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 8000,
};
const MAX_VISIBLE = 4;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, number>();

function emit() {
  listeners.forEach(listener => listener());
}

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  items = items.filter(item => item.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, options: ToastOptions = {}) {
  const id = nextId++;
  items = [...items, { id, kind, message, title: options.title }].slice(-MAX_VISIBLE);
  emit();
  const duration = options.duration ?? DEFAULT_DURATION[kind];
  if (duration > 0) timers.set(id, window.setTimeout(() => dismiss(id), duration));
  return id;
}

/** 全局轻提示，可在组件外（hooks、事件回调）直接调用，替代阻塞式 window.alert。 */
export const toast = {
  success: (message: string, options?: ToastOptions) => push('success', message, options),
  error: (message: string, options?: ToastOptions) => push('error', message, options),
  warning: (message: string, options?: ToastOptions) => push('warning', message, options),
  info: (message: string, options?: ToastOptions) => push('info', message, options),
  dismiss,
};

/** 把 invoke 抛出的错误统一转成可读文本。 */
export function errorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  return error ? String(error) : fallback;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const KIND_TONE: Record<ToastKind, string> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'idle',
};

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, () => items);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-5 bottom-5 z-[200] flex w-[348px] max-w-[calc(100vw-2.5rem)] flex-col gap-2"
    >
      {toasts.map(item => (
        <div
          key={item.id}
          role={item.kind === 'error' ? 'alert' : 'status'}
          className="animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-[16px] bg-[var(--surface)] px-4 py-3 text-foreground shadow-[var(--selected-shadow)]"
        >
          <span
            className="bento-status-dot mt-[6px]"
            data-tone={KIND_TONE[item.kind]}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            {item.title && <p className="text-body font-semibold break-all">{item.title}</p>}
            <p className={cn('break-words whitespace-pre-wrap leading-relaxed', item.title ? 'mt-0.5 text-label text-muted-foreground' : 'text-body')}>
              {item.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label="关闭提示"
            className="button-neutral -mr-1 -mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
