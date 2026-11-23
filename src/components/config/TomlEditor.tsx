import React, { useMemo, useRef } from 'react';
import { cn } from '../../lib/utils';

interface TomlEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 解析出错的行号（1 起），在行号栏中标红 */
  errorLine?: number | null;
}

const INDENT = '  ';

/** 带行号栏的 TOML 文本编辑器（Bento 深色代码面板风格）。 */
export default function TomlEditor({ value, onChange, disabled, errorLine }: TomlEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    onChange(value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd));
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + INDENT.length;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 bg-transparent font-mono text-[12.5px] leading-[22px]">
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="w-12 shrink-0 overflow-hidden border-r border-white/[0.08] bg-white/[0.02] py-3.5 pb-10 text-right text-[#6e6e73] tabular-nums select-none"
      >
        {Array.from({ length: lineCount }, (_, index) => {
          const line = index + 1;
          return (
            <div
              key={line}
              className={cn('pr-3', line === errorLine && 'bg-[#ff453a]/20 font-medium text-[#ff453a]')}
            >
              {line}
            </div>
          );
        })}
      </div>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={event => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        disabled={disabled}
        aria-label="编辑 config.toml 配置"
        aria-invalid={errorLine ? true : undefined}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        wrap="off"
        className="min-h-0 min-w-0 flex-1 resize-none bg-transparent px-4 py-3.5 text-[#d1d1d6] caret-white focus:outline-none disabled:opacity-60"
      />
    </div>
  );
}
