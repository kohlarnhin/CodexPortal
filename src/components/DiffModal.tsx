import React from 'react';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-lg overflow-hidden animate-modal-in">
        <div className="px-5 py-4 border-b border-[#EAEAEA] flex items-center justify-between">
          <h3 className="font-medium text-[15px] text-black">确认修改</h3>
          <button onClick={onClose} className="text-[#999999] hover:text-black transition-colors">
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
                    {typeof diff.newVal === 'object' ? JSON.stringify(diff.newVal) : String(diff.newVal ?? '未删除')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#EAEAEA] flex items-center justify-end gap-2">
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
