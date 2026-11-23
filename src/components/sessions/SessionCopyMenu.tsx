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
        className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
      >
        {copied ? <Check aria-hidden="true" size={12.5} className="text-success" /> : <Copy aria-hidden="true" size={12.5} />}
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
          className="bento-popup animate-fade-in fixed z-[120] w-44 max-h-[calc(100vh-12px)] overflow-y-auto p-1"
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
              className="flex w-full cursor-pointer items-center rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              {option.label}
            </button>
          ))}
          {error && <p role="alert" className="px-2.5 py-1.5 text-caption text-destructive">{error}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
