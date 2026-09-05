import React, { useEffect, useId, useRef } from 'react';

export interface DiffItem {
  key: string;
  oldVal: any;
  newVal: any;
}

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  diffs: DiffItem[];
}

export default function DiffModal({ isOpen, onClose, onConfirm, diffs }: DiffModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6 backdrop-blur-sm animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          if (event.key === 'Tab') {
            const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
            const first = buttons?.[0];
            const last = buttons?.[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first?.focus();
            }
          }
        }}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#EAEAEA] bg-white shadow-2xl outline-none animate-modal-in"
      >
        <div className="px-5 py-4 border-b border-[#EAEAEA] flex shrink-0 items-center justify-between">
          <h3 id={titleId} className="font-medium text-[15px] text-black">确认修改</h3>
          <button onClick={onClose} aria-label="关闭差异预览" className="text-[#999999] hover:text-black transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        
        <div className="px-5 py-4 bg-[#FAFAFA] max-h-[300px] overflow-y-auto">
          <p className="text-[13px] text-[#666666] mb-4">即将应用以下 {diffs.length} 处配置更改：</p>
          <div className="flex flex-col gap-2">
            {diffs.map((diff, i) => (
              <div key={i} className="flex flex-col bg-white border border-[#EAEAEA] rounded-md p-3 text-[13px]">
                <div className="font-medium text-black mb-1.5">{diff.key}</div>
                <div className="flex items-center gap-3 font-mono text-[12px]">
                  <div className="bg-[#FFF0F0] text-[#D32F2F] px-1.5 py-0.5 rounded truncate max-w-[180px]">
                    {typeof diff.oldVal === 'object' ? JSON.stringify(diff.oldVal) : String(diff.oldVal ?? '未设置')}
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  <div className="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded truncate max-w-[180px]">
                    {typeof diff.newVal === 'object' ? JSON.stringify(diff.newVal) : String(diff.newVal ?? '已删除')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#EAEAEA] flex shrink-0 items-center justify-end gap-2">
          <button 
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F5F5F5] hover:text-black rounded-md transition-colors"
          >
            取消
          </button>
          <button 
            onClick={onConfirm}
            className="px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
          >
            确认保存
          </button>
        </div>
      </div>
    </div>
  );
}
