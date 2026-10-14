import React from 'react';
import type { UpdaterController } from '../hooks/useUpdater';
import Markdown from './Markdown';
import Button from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

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
    ? `正在下载${downloadProgress === null ? '...' : ` ${downloadProgress}%`}`
    : status === 'installing'
      ? (installMode === 'portable' ? '正在替换程序...' : '正在安装...')
      : status === 'restarting'
        ? '正在重启...'
        : status === 'error'
          ? '重新尝试'
          : '立即升级';

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => { if (!open && !isBusy) closeModal(); }}>
      <DialogContent
        className="max-w-lg p-0 max-h-[82vh] flex flex-col overflow-hidden gap-0"
        showCloseButton={false}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md border bg-muted text-foreground flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
            </div>
            <div>
              <h3 id="update-modal-title" className="font-semibold text-[15px] text-foreground tracking-tight">发现新版本</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">Codex Portal {update.version} 已准备就绪</p>
            </div>
          </div>

          {!isBusy && (
            <button
              type="button"
              onClick={closeModal}
              aria-label="关闭更新窗口"
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          <div className="flex items-center justify-center gap-4 bg-muted/50 border border-border rounded-lg px-5 py-4 mb-5">
            <div className="text-center min-w-[100px]">
              <div className="text-[11px] text-muted-foreground mb-1">当前版本</div>
              <div className="text-[16px] font-bold font-mono text-muted-foreground">v{update.currentVersion}</div>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            <div className="text-center min-w-[100px]">
              <div className="text-[11px] text-muted-foreground mb-1">最新版本</div>
              <div className="text-[16px] font-bold font-mono text-foreground">v{update.version}</div>
            </div>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[13px] font-semibold text-foreground">更新内容</h4>
              {publishDate && <span className="text-[11px] text-muted-foreground/70">{publishDate}</span>}
            </div>
            <div className="bg-card border rounded-lg px-4 py-3.5 min-h-[88px]">
              {update.body?.trim() ? (
                <Markdown content={update.body} />
              ) : (
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  本次更新包含功能优化与问题修复。
                </p>
              )}
            </div>
          </div>

          {isBusy && (
            <div className="bg-muted/50 border border-border rounded-lg p-4">
              <div className="flex items-center justify-between text-[12px] mb-2.5">
                <span className="font-medium text-muted-foreground">{progressLabel}</span>
                {status === 'downloading' && downloadProgress !== null && (
                  <span className="font-mono text-muted-foreground">{downloadProgress}%</span>
                )}
              </div>
              <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
                <div
                  role="progressbar"
                  aria-label="更新下载进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={downloadProgress ?? undefined}
                  className={`h-full bg-primary rounded-full transition-all duration-300 ${downloadProgress === null ? 'w-1/3 animate-pulse' : ''}`}
                  style={downloadProgress === null ? undefined : { width: `${downloadProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground/70 mt-2.5">
                {installMode === 'portable'
                  ? '更新完成后应用将自动重启，请不要移动或删除程序文件。'
                  : '安装完成后应用将自动重启，请不要关闭程序。'}
              </p>
            </div>
          )}

          {status === 'error' && error && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg px-4 py-3 text-[12px] text-destructive leading-relaxed break-all">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 bg-muted/50 border-t border-border flex items-center justify-end gap-2.5 shrink-0">
          {!isBusy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeModal}
            >
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
            {isBusy && (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            )}
            {progressLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
