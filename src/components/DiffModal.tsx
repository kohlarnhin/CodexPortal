import React from 'react';
import Button from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

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
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg p-6 gap-4">
        <DialogHeader>
          <DialogTitle>确认修改配置</DialogTitle>
          <DialogDescription>
            即将应用以下 {diffs.length} 处配置更改，确认后写入本地配置文件。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[340px] overflow-y-auto space-y-2.5 pr-1 py-1">
          {diffs.map((diff, i) => (
            <div key={i} className="flex flex-col bg-[#F9F9F9] border border-[#EAEAEA] rounded-xl p-3 text-[13px]">
              <div className="font-mono font-medium text-black text-[12px] mb-2">{diff.key}</div>
              <div className="flex items-center gap-2.5 font-mono text-[11px] flex-wrap">
                <div className="bg-[#FFF0F0] text-[#D32F2F] px-2 py-0.5 rounded-md truncate max-w-[200px]">
                  {typeof diff.oldVal === 'object' ? JSON.stringify(diff.oldVal) : String(diff.oldVal ?? '未设置')}
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                <div className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md truncate max-w-[200px]">
                  {typeof diff.newVal === 'object' ? JSON.stringify(diff.newVal) : String(diff.newVal ?? '已删除')}
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2.5 pt-2">
          <Button 
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            取消
          </Button>
          <Button 
            variant="default"
            size="sm"
            onClick={onConfirm}
          >
            确认保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
