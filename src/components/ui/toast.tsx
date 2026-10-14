import { useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
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

const KIND_META: Record<ToastKind, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: 'text-success' },
  error: { icon: CircleAlert, className: 'text-destructive' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  info: { icon: Info, className: 'text-info' },
};

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, () => items);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[200] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map(item => {
        const { icon: Icon, className } = KIND_META[item.kind];
        return (
          <div
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
            className="animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-popover px-3.5 py-3 text-popover-foreground shadow-lg"
          >
            <Icon size={16} className={cn('mt-px shrink-0', className)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              {item.title && <p className="text-body font-medium break-all">{item.title}</p>}
              <p className={cn('text-label break-words whitespace-pre-wrap', item.title ? 'mt-0.5 text-muted-foreground' : 'text-body')}>
                {item.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="关闭提示"
              className="-mr-1 -mt-0.5 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
