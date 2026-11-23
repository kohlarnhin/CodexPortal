import type { CodexActiveSession, CodexSessionMonitor } from '../types/codexEvents';
import { ActionTooltip } from './ui/tooltip';
import { ArrowRight, Folder, RefreshCw } from 'lucide-react';

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
    const cwd = session.cwd?.replace(/\\/g, '/').replace(/\/+$/, '') || (session.cwd ? '/' : null);
    const key = cwd === null ? 'unknown' : `cwd:${cwd}`;
    const project = projects.get(key);
    if (project) {
      project.sessionCount += 1;
      project.lastActivityAt = Math.max(project.lastActivityAt, session.lastActivityAt);
    } else {
      projects.set(key, {
        key,
        cwd: session.cwd,
        name: projectName(session.cwd) ?? '未识别项目',
        sessionCount: 1,
        lastActivityAt: session.lastActivityAt,
      });
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
  const status = monitor.discoveryFailed
    ? '刷新待重试'
    : connected
      ? '监听中'
      : monitor.connectionStatus === 'unavailable'
        ? '实时监听未启用'
        : '连接中';
  const emptyTitle = monitor.discoveryFailed
    ? '项目信息暂时无法更新'
    : monitor.connectionStatus === 'unavailable'
      ? '额度在会话同步后更新'
      : monitor.activeCount === null
        ? '正在获取活跃项目…'
        : '暂无活跃项目';

  return (
    <section aria-labelledby="codex-sessions-title" className="flex min-h-min flex-1 flex-col gap-2">
      <header className="flex shrink-0 items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          <h3 id="codex-sessions-title" className="bento-group-title">活跃会话</h3>
          <span
            role="status"
            title={
              monitor.lastQuotaPushAt !== null
                ? `最近额度推送 ${formatTime(monitor.lastQuotaPushAt)}`
                : monitor.lastSyncedAt !== null
                  ? `会话更新于 ${formatTime(monitor.lastSyncedAt)}`
                  : '连接后自动发现会话'
            }
            className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
          >
            <span
              className="bento-status-dot"
              data-tone={monitor.discoveryFailed ? 'warning' : connected ? 'running' : 'idle'}
              aria-hidden="true"
            />
            {status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <ActionTooltip label={monitor.isRefreshing ? '正在刷新活跃会话…' : '刷新活跃会话'}>
            <button
              type="button"
              aria-label="刷新活跃会话"
              onClick={onRefresh}
              disabled={!connected || monitor.isRefreshing}
              className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw aria-hidden="true" size={13} className={monitor.isRefreshing ? 'animate-spin' : ''} />
            </button>
          </ActionTooltip>
          <button type="button" className="bento-tag text-muted-foreground hover:text-foreground" onClick={onViewLogs}>
            查看日志
            <ArrowRight aria-hidden="true" size={12} />
          </button>
        </div>
      </header>

      <div className="bento-group grid flex-1 grid-cols-[136px_minmax(0,1fr)] overflow-hidden @min-[560px]/page:grid-cols-[152px_minmax(0,1fr)]">
        <div className="flex flex-col border-r border-[var(--hairline-divider)] px-[18px] py-3.5">
          <p className="text-caption text-[var(--label)]">活跃会话总数</p>
          <div className="flex flex-1 items-center justify-center py-3">
            <p aria-live="polite" aria-atomic="true" className="flex items-baseline gap-1.5">
              <span className="text-[32px] font-semibold leading-none tracking-[-0.025em] text-foreground tabular-nums">
                {monitor.activeCount ?? '—'}
              </span>
              {monitor.activeCount !== null && <span className="text-label text-muted-foreground">个</span>}
            </p>
          </div>
          <p
            title="空闲 5 分钟自动移出，发送新消息自动恢复。"
            className="text-caption text-[var(--label)]"
          >
            空闲 5 分钟移出
          </p>
        </div>

        <div className="flex min-w-0 flex-col px-[18px] py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-caption text-[var(--label)]">活跃项目</p>
            <span className="text-caption text-[var(--label)]">最近活跃</span>
          </div>
          <ul aria-label="最近活跃的项目" className="mt-2.5 grid flex-1 grid-cols-3 gap-2.5">
            {projectSlots.map((project, index) =>
              project ? (
                <li
                  key={project.key}
                  title={project.cwd ?? project.name}
                  className="flex min-w-0 flex-col justify-between gap-2.5 rounded-[10px] bg-muted/60 p-3 dark:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--button-fill)] text-muted-foreground">
                      <Folder aria-hidden="true" size={14} />
                    </span>
                    <span
                      aria-label={`${project.sessionCount} 个活跃会话`}
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-caption font-medium text-primary-foreground tabular-nums"
                    >
                      {project.sessionCount}
                    </span>
                  </div>
                  <p className="min-w-0 truncate text-label font-medium leading-4 text-foreground">
                    {project.name}
                  </p>
                </li>
              ) : (
                <li
                  key={`placeholder-${index}`}
                  aria-hidden="true"
                  className="flex min-w-0 items-center justify-center rounded-[10px] border border-dashed border-[var(--hairline-control)] p-3 text-body text-[var(--label)]/50"
                >
                  —
                </li>
              ),
            )}
          </ul>
          {projects.length === 0 && (
            <p className="mt-2 text-caption text-[var(--label)]">
              {emptyTitle}
              {monitor.discoveryFailed ? '，将自动重试。' : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
