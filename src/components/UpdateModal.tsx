import type { UpdaterController } from '../hooks/useUpdater';
import Markdown from './Markdown';
import Button from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ChevronRight, LoaderCircle } from 'lucide-react';

interface UpdateModalProps {
  updater: UpdaterController;
}

function formatPublishDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export default function UpdateModal({ updater }: UpdateModalProps) {
  const {
    status,
    installMode,
    update,
    error,
    downloadProgress,
    isModalOpen,
    isBusy,
    installUpdate,
    closeModal,
  } = updater;

  if (!isModalOpen || !update) return null;

  const publishDate = formatPublishDate(update.date);
  const progressLabel = status === 'downloading'
    ? `正在下载${downloadProgress === null ? '…' : ` ${downloadProgress}%`}`
    : status === 'installing'
      ? (installMode === 'portable' ? '正在替换程序…' : '正在安装…')
      : status === 'restarting'
        ? '正在重启…'
        : status === 'error'
          ? '重新尝试'
          : '立即升级';

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => { if (!open && !isBusy) closeModal(); }}>
      <DialogContent
        className="flex max-h-[82vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        showCloseButton={!isBusy}
      >
        <DialogHeader className="shrink-0 border-b border-[var(--hairline-divider)] px-6 py-4 pr-14">
          <DialogTitle>发现新版本</DialogTitle>
          <DialogDescription>Codex Portal v{update.version} 已准备就绪</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="bento-group flex items-center justify-center gap-5 px-5 py-4">
            <div className="min-w-[96px] text-center">
              <div className="mb-1 text-caption text-[var(--label)]">当前版本</div>
              <div className="font-mono text-title font-semibold text-muted-foreground tabular-nums">
                v{update.currentVersion}
              </div>
            </div>
            <ChevronRight size={16} className="text-[var(--label)]" />
            <div className="min-w-[96px] text-center">
              <div className="mb-1 text-caption text-[var(--label)]">最新版本</div>
              <div className="font-mono text-title font-semibold text-foreground tabular-nums">
                v{update.version}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <h4 className="bento-group-title">更新内容</h4>
              {publishDate && <span className="text-caption text-[var(--label)]">{publishDate}</span>}
            </div>
            <div className="bento-group min-h-[88px] px-4 py-3.5">
              {update.body?.trim() ? (
                <Markdown content={update.body} />
              ) : (
                <p className="text-body leading-relaxed text-muted-foreground">
                  本次更新包含功能优化与问题修复。
                </p>
              )}
            </div>
          </div>

          {isBusy && (
            <div className="bento-group p-4">
              <div className="mb-2.5 flex items-center justify-between text-label">
                <span className="font-medium text-foreground">{progressLabel}</span>
                {status === 'downloading' && downloadProgress !== null && (
                  <span className="font-mono text-muted-foreground tabular-nums">{downloadProgress}%</span>
                )}
              </div>
              <div className="h-[5px] overflow-hidden rounded-full bg-[var(--button-fill)]">
                <div
                  role="progressbar"
                  aria-label="更新下载进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={downloadProgress ?? undefined}
                  className={`h-full rounded-full bg-primary transition-all duration-300 ${downloadProgress === null ? 'w-1/3 animate-pulse' : ''}`}
                  style={downloadProgress === null ? undefined : { width: `${downloadProgress}%` }}
                />
              </div>
              <p className="mt-2.5 text-caption text-[var(--label)]">
                {installMode === 'portable'
                  ? '更新完成后应用将自动重启，请不要移动或删除程序文件。'
                  : '安装完成后应用将自动重启，请不要关闭程序。'}
              </p>
            </div>
          )}

          {status === 'error' && error && (
            <div className="rounded-[10px] bg-destructive/10 px-4 py-3 text-label leading-relaxed text-destructive break-all">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--hairline-divider)] px-6 py-3.5">
          {!isBusy && (
            <Button type="button" variant="outline" size="sm" onClick={closeModal}>
              {status === 'error' ? '关闭' : '稍后提醒'}
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void installUpdate()}
            disabled={isBusy}
            className="min-w-[96px]"
          >
            {isBusy && <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />}
            {progressLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
