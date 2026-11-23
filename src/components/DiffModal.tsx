import Button from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { ChevronRight } from 'lucide-react';

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
      <DialogContent className="max-w-lg gap-4 p-6">
        <DialogHeader>
          <DialogTitle>确认修改配置</DialogTitle>
          <DialogDescription>
            即将应用以下 {diffs.length} 处配置更改，确认后写入本地配置文件。
          </DialogDescription>
        </DialogHeader>

        <div className="bento-group max-h-[340px] overflow-y-auto">
          {diffs.map((diff, i) => (
            <div key={i} className="flex flex-col gap-2 border-t border-[var(--hairline-divider)] px-4 py-3 first:border-t-0">
              <div className="font-mono text-label font-medium text-foreground">{diff.key}</div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
                <div className="max-w-[200px] truncate rounded-full bg-destructive/10 px-2.5 py-0.5 text-destructive">
                  {typeof diff.oldVal === 'object' ? JSON.stringify(diff.oldVal) : String(diff.oldVal ?? '未设置')}
                </div>
                <ChevronRight size={13} className="shrink-0 text-[var(--label)]" />
                <div className="max-w-[200px] truncate rounded-full bg-success/12 px-2.5 py-0.5 text-success">
                  {typeof diff.newVal === 'object' ? JSON.stringify(diff.newVal) : String(diff.newVal ?? '已删除')}
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 border-t border-[var(--hairline-divider)] pt-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="default" size="sm" onClick={onConfirm}>
            确认保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
