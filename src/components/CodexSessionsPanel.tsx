import type { CodexActiveSession, CodexSessionMonitor } from '../types/codexEvents';
import Button from './ui/button';
import { ActionTooltip } from './ui/tooltip';
import { cn } from '../lib/utils';

interface CodexSessionsPanelProps {
  monitor: CodexSessionMonitor;
  onRefresh: () => void;
  onViewLogs: () => void;
}

interface ActiveProject {
  key: string;
  cwd: string | null;
  name: string;
  sessionCount: number;
  lastActivityAt: number;
}

const MAX_VISIBLE_PROJECTS = 3;

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function projectName(cwd: string | null) {
  if (!cwd) return null;
  return cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? cwd;
}

function recentProjects(sessions: CodexActiveSession[]) {
  const projects = new Map<string, ActiveProject>();
  for (const session of sessions) {
    // 按完整工作目录合并；同名但位于不同目录的项目仍分别统计。
    const cwd = session.cwd?.replace(/\\/g, '/').replace(/\/+$/, '') || (session.cwd ? '/' : null);
    const key = cwd === null ? 'unknown' : `cwd:${cwd}`;
    const project = projects.get(key);
    if (project) {
      project.sessionCount += 1;
      project.lastActivityAt = Math.max(project.lastActivityAt, session.lastActivityAt);
    } else {
      projects.set(key, { key, cwd: session.cwd, name: projectName(session.cwd) ?? '未识别项目',
        sessionCount: 1, lastActivityAt: session.lastActivityAt });
    }
  }
  return [...projects.values()]
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.key.localeCompare(b.key))
    .slice(0, MAX_VISIBLE_PROJECTS);
}

export default function CodexSessionsPanel({ monitor, onRefresh, onViewLogs }: CodexSessionsPanelProps) {
  const projects = recentProjects(monitor.sessions);
  const projectSlots = Array.from({ length: MAX_VISIBLE_PROJECTS }, (_, index) => projects[index] ?? null);
  const connected = monitor.connectionStatus === 'connected';
  const status = monitor.discoveryFailed ? '刷新待重试' : connected ? '监听中'
    : monitor.connectionStatus === 'reconnecting' ? '重新连接中' : '连接中';
  const emptyTitle = monitor.discoveryFailed ? '项目信息暂时无法更新'
    : monitor.activeCount === null ? '正在获取活跃项目…' : '暂无活跃项目';

  return (
    <section aria-labelledby="codex-sessions-title" className="flex min-h-min flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-2xs">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5">
        <h3 id="codex-sessions-title" className="text-[13px] font-semibold text-neutral-800">活跃会话</h3>
        <div className="flex items-center gap-2.5">
          <span role="status"
            title={monitor.lastQuotaPushAt !== null ? `最近额度推送 ${formatTime(monitor.lastQuotaPushAt)}`
              : monitor.lastSyncedAt !== null ? `会话更新于 ${formatTime(monitor.lastSyncedAt)}` : '连接后自动发现会话'}
            className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className={cn('h-1.5 w-1.5 rounded-full', monitor.discoveryFailed ? 'bg-amber-500' : connected ? 'bg-emerald-500' : 'bg-neutral-300')} />
            {status}
          </span>
          <ActionTooltip label={monitor.isRefreshing ? '正在刷新活跃会话…' : '刷新活跃会话'}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新活跃会话"
              onClick={onRefresh} disabled={!connected || monitor.isRefreshing}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={monitor.isRefreshing ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 21h5v-5" />
              </svg>
            </Button>
          </ActionTooltip>
          <span aria-hidden="true" className="h-3 w-px bg-neutral-200" />
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-[11px]" onClick={onViewLogs}>
            查看日志
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[120px_minmax(0,1fr)] @min-[560px]/page:grid-cols-[140px_minmax(0,1fr)]">
        <div className="flex flex-col border-r border-neutral-100 px-4 py-3">
          <div className="flex h-4 shrink-0 items-baseline">
            <p className="text-[11px] leading-4 text-neutral-500">活跃会话总数</p>
          </div>
          <div className="mt-2 flex flex-1 flex-col justify-between py-3">
            <p aria-live="polite" aria-atomic="true" className="flex items-baseline gap-1.5">
              <span className="font-mono text-[32px] leading-none tracking-tight text-neutral-900 tabular-nums">{monitor.activeCount ?? '—'}</span>
              {monitor.activeCount !== null && <span className="text-[12px] text-neutral-400">个</span>}
            </p>
            <p title="空闲 5 分钟自动移出，发送新消息自动恢复。" className="text-[11px] leading-4 text-neutral-400">空闲 5 分钟移出</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col px-4 py-3">
          <div className="flex h-4 shrink-0 items-baseline justify-between gap-3">
            <p className="text-[11px] leading-4 text-neutral-500">活跃项目</p>
            <span className="text-[10px] leading-4 text-neutral-400">最近活跃</span>
          </div>
          <ul aria-label="最近活跃的项目" className="mt-2 grid flex-1 grid-cols-3 gap-2">
            {projectSlots.map((project, index) => project ? (
                <li key={project.key} title={project.cwd ?? project.name}
                  className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-neutral-200/70 bg-neutral-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-400">
                      <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
                    </svg>
                    <span aria-label={`${project.sessionCount} 个活跃会话`}
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-neutral-900 px-1.5 font-mono text-[11px] font-medium text-white tabular-nums">
                      {project.sessionCount}
                    </span>
                  </div>
                  <p className="min-w-0 truncate text-[12px] font-medium leading-4 text-neutral-800">{project.name}</p>
                </li>
            ) : (
              <li key={`placeholder-${index}`} aria-hidden="true"
                className="flex min-w-0 items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/30 p-3 text-[16px] text-neutral-300">
                —
              </li>
            ))}
          </ul>
          {projects.length === 0 && (
            <p className="mt-2 text-[11px] leading-normal text-neutral-400">
              {emptyTitle}{monitor.discoveryFailed ? '，将自动重试。' : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
