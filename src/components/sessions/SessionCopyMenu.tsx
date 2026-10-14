import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionRecord } from '../../types/session';
import { copyText } from '../../utils/clipboard';
import { Check, ChevronDown, Copy } from 'lucide-react';

export default function SessionCopyMenu({ session }: { session: SessionRecord }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<number>();
  const mountedRef = useRef(true);
  const copyingRef = useRef(false);
  const initialFocusRef = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const triggerId = useId();
  const options = [
    { label: '复制会话 ID', value: session.id },
    { label: '复制恢复命令', value: `codex resume ${session.id}` },
    { label: '复制会话文件路径', value: session.filePath },
    { label: '复制项目路径', value: session.projectPath },
  ];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      setPosition({
        left: Math.max(gap, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - gap)),
        top: rect.bottom + menu.offsetHeight + gap <= window.innerHeight
          ? rect.bottom + gap : Math.max(gap, rect.top - menu.offsetHeight - gap),
      });
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node
        && !triggerRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    updatePosition();
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (items?.length) items[initialFocusRef.current === 'last' ? items.length - 1 : 0].focus({ preventScroll: true });
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open, error]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const copy = async (value: string) => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    setCopied(false);
    window.clearTimeout(feedbackTimerRef.current);
    setError(null);
    const ok = await copyText(value);
    copyingRef.current = false;
    if (!mountedRef.current) return;
    setCopying(false);
    if (!ok) {
      setError('复制失败，请重试');
      return;
    }
    setCopied(true);
    close();
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="inline-flex shrink-0" onClick={event => event.stopPropagation()}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={copied ? '已复制' : '选择复制内容'}
        title={copied ? '已复制' : '选择复制内容'}
        onClick={() => {
          initialFocusRef.current = 'first';
          setError(null);
          setOpen(current => !current);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
            setError(null);
            setOpen(true);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        {copied ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
        <span role="status">{copied ? '已复制' : '复制'}</span>
        <ChevronDown aria-hidden="true" size={10} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          aria-busy={copying}
          style={position}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault();
              close();
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
            if (!items.length) return;
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next].focus();
          }}
          className="fixed z-[120] w-44 max-h-[calc(100vh-12px)] overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.map(option => (
            <button
              key={option.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={copying || !option.value.trim()}
              title={option.value || '此会话未记录该路径'}
              onClick={() => void copy(option.value)}
              className="flex w-full rounded-md px-3 py-2 text-left text-label text-muted-foreground hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              {option.label}
            </button>
          ))}
          {error && <p role="alert" className="px-3 py-2 text-caption text-destructive">{error}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
