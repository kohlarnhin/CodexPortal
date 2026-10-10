import { useRef, useState } from 'react';
import type { Account } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import Button from './ui/button';
import Input from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface AccountAutoSwitchModalProps {
  account: Account;
  isEmailMaskingEnabled: boolean;
  autoSwitchEnabled: boolean | null;
  onClose: () => void;
  onSave: (id: string, threshold: number) => Promise<void>;
}

export default function AccountAutoSwitchModal({
  account, isEmailMaskingEnabled, autoSwitchEnabled, onClose, onSave,
}: AccountAutoSwitchModalProps) {
  const [value, setValue] = useState(String(account.autoSwitchThreshold));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const threshold = value.trim() ? Number(value) : NaN;
  const valid = Number.isFinite(threshold) && threshold >= 0 && threshold <= 100;

  const save = async () => {
    if (!valid || saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(account.id, threshold);
      onClose();
    } catch (saveError) {
      setError(`阈值保存失败：${String(saveError)}`);
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}>
      <DialogContent className="max-w-sm" showCloseButton={!isSaving}>
        <DialogHeader>
          <DialogTitle>自动切换账号</DialogTitle>
          <DialogDescription className="truncate font-mono">
            {getDisplayedEmail(account.name, isEmailMaskingEnabled)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
          {autoSwitchEnabled === false && (
            <p className="rounded-lg bg-neutral-100 px-3 py-2 text-[12px] leading-relaxed text-neutral-500">
              自动切换总开关已关闭，阈值将在开启后生效。
            </p>
          )}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <label htmlFor="auto-switch-threshold" className="block text-[12px] font-medium text-neutral-800">
              剩余额度阈值
            </label>
            <div className="relative mt-2">
              <Input id="auto-switch-threshold" type="number" inputMode="decimal" min={0} max={100}
                step="any" value={value} disabled={isSaving} aria-describedby="auto-switch-help"
                aria-invalid={!valid} className="pr-9 font-mono"
                onChange={(event) => { setValue(event.target.value); setError(null); }} />
              <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">%</span>
            </div>
            <p id="auto-switch-help" className="mt-2 text-[11px] leading-relaxed text-neutral-500">
              默认 0%，额度用尽时切换。设置为 5% 时，该账号短周期或长周期剩余 ≤ 5% 即自动切换。
            </p>
          </div>
          <p className="text-[12px] leading-relaxed text-neutral-500">
            从额度充足的其他账号中，优先切换至短周期下一次重置时间最近的账号。
          </p>
          {!valid && <p role="alert" className="text-[12px] text-red-600">请输入 0 到 100 之间的额度百分比。</p>}
          {error && <p role="alert" className="text-[12px] text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSaving} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={isSaving || !valid}>{isSaving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
