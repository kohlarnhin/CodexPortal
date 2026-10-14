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

/** 带行号栏的 TOML 文本编辑器；行号随滚动同步，Tab 键插入两个空格。 */
export default function TomlEditor({ value, onChange, disabled, errorLine }: TomlEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    onChange(value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd));
    // 等受控值写回后再恢复光标位置。
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + INDENT.length;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 bg-card font-mono text-body leading-relaxed">
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="w-12 shrink-0 overflow-hidden border-r bg-muted/30 py-4 pb-10 text-right text-muted-foreground/60 tabular-nums select-none"
      >
        {Array.from({ length: lineCount }, (_, index) => {
          const line = index + 1;
          return (
            <div
              key={line}
              className={cn('pr-3', line === errorLine && 'bg-destructive/10 font-medium text-destructive')}
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
        className="min-h-0 min-w-0 flex-1 resize-none bg-transparent px-4 py-4 text-foreground focus:outline-none disabled:opacity-60"
      />
    </div>
  );
}
