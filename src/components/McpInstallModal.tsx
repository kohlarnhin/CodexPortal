import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useMcpInstall } from '../hooks/useMcpInstall';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';

function InstallChannel({ name, installation }: {
  name: string;
  installation: ReturnType<typeof useMcpInstall>;
}) {
  const { status, isLoading, isInstalling, canInstall, error, install } = installation;

  return (
    <li className="border-t border-[var(--hairline-divider)] px-4 py-3 first:border-t-0">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-subtitle font-medium text-foreground">{name}</div>
          {status === 'claudeNotFound' && (
            <p className="mt-0.5 text-caption text-[var(--label)]">请先启动 Claude Code</p>
          )}
        </div>
        {isLoading ? (
          <span role="status" className="flex shrink-0 items-center gap-1.5 text-label text-muted-foreground">
            <LoaderCircle aria-hidden="true" size={12} className="animate-spin" />
            读取中…
          </span>
        ) : status === 'installed' ? (
          <span role="status" className="flex shrink-0 items-center gap-1.5 text-label font-medium text-success">
            <Check aria-hidden="true" size={13} strokeWidth={2.5} />
            已安装
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={!canInstall}
            aria-label={status === 'outdated' ? `更新 ${name} 配置` : `安装到 ${name}`}
            aria-busy={isInstalling}
            onClick={() => void install()}
          >
            {isInstalling && <LoaderCircle aria-hidden="true" size={12} className="animate-spin" />}
            {isInstalling ? '安装中…' : status === 'outdated' ? '更新配置' : '安装'}
          </Button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 break-words text-label text-destructive">{error}</p>}
    </li>
  );
}

export default function McpInstallModal() {
  const [open, setOpen] = useState(false);
  const codex = useMcpInstall('codex', open);
  const claude = useMcpInstall('claude', open);
  const isInstalling = codex.isInstalling || claude.isInstalling;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isInstalling) setOpen(nextOpen); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0" aria-label="安装 MCP 服务">
          安装
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm gap-4 p-6" showCloseButton={!isInstalling}>
        <DialogHeader>
          <DialogTitle>安装 MCP 服务</DialogTitle>
          <DialogDescription>
            安装后重新打开对应客户端。调用工具时请保持 Codex Portal 运行。
          </DialogDescription>
        </DialogHeader>
        <ul aria-label="安装渠道" className="bento-group overflow-hidden">
          <InstallChannel name="Codex" installation={codex} />
          <InstallChannel name="Claude Code" installation={claude} />
        </ul>
      </DialogContent>
    </Dialog>
  );
}
