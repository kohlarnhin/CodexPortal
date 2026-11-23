import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useSessions } from '../hooks/useSessions';
import { SessionProject, SessionRecord } from '../types/session';
import { formatDateTime, formatRelativeTime } from '../utils/time';
import { formatTokens } from '../utils/format';
import ProjectCard from './sessions/ProjectCard';
import SessionRow from './sessions/SessionRow';
import SessionDetailPanel from './sessions/SessionDetailPanel';
import SessionListView from './sessions/SessionListView';
import SearchInput from './sessions/SearchInput';
import ConfirmModal from './ConfirmModal';
import SegmentedControl from './SegmentedControl';
import ToggleSwitch from './ToggleSwitch';
import Button from './ui/button';
import PageHeader from './ui/page-header';
import { ChevronLeft, Clock, RefreshCw } from 'lucide-react';
import { errorMessage, toast } from './ui/toast';

type ViewState =
  | { type: 'projects' }
  | { type: 'sessions' }
  | { type: 'project'; project: SessionProject };

interface SessionsPageProps {
  detailContainer: HTMLElement | null;
}

const SessionsPage: React.FC<SessionsPageProps> = ({ detailContainer }) => {
  const [view, setView] = useState<ViewState>({ type: 'projects' });
  const [search, setSearch] = useState('');
  const [includeSubagents, setIncludeSubagents] = useState(false);
  const [detailSession, setDetailSession] = useState<SessionRecord | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const handleSessionsReset = useCallback(() => {
    setView({ type: 'projects' });
    setSearch('');
    setDetailSession(null);
  }, []);
  const sessions = useSessions(handleSessionsReset, includeSubagents);

  const filteredProjects = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return sessions.projects;
    return sessions.projects.filter(
      project =>
        project.name.toLowerCase().includes(keyword) ||
        project.path.toLowerCase().includes(keyword),
    );
  }, [sessions.projects, search]);

  const openProject = (project: SessionProject) => {
    sessions.activeProjectPathRef.current = project.path;
    setView({ type: 'project', project });
    void sessions.loadProjectSessions(project.path);
  };

  const goBack = () => {
    sessions.activeProjectPathRef.current = null;
    setView({ type: 'projects' });
  };

  const handleRevealInFinder = async (session: SessionRecord) => {
    try {
      await revealItemInDir(session.filePath);
    } catch (err) {
      toast.error(errorMessage(err), { title: '无法在 Finder 中打开' });
    }
  };

  const isSyncing = sessions.isSyncing || sessions.syncProgress !== null;
  const syncPercent = sessions.syncProgress
    ? sessions.syncProgress.total === 0
      ? 100
      : Math.min(100, Math.max(0, Math.round((sessions.syncProgress.done / sessions.syncProgress.total) * 100)))
    : undefined;
  const currentProjectPath = view.type === 'project' ? view.project.path : null;

  return (
    <div
      className="page-layout"
      style={{ visibility: detailSession && detailContainer ? 'hidden' : undefined }}
    >
      <PageHeader
        title="会话管理"
        center={
          <SegmentedControl
            size="sm"
            label="会话视图"
            value={view.type === 'sessions' ? 'sessions' : 'projects'}
            onChange={type => {
              sessions.activeProjectPathRef.current = null;
              setView({ type });
            }}
            options={[{ id: 'projects', label: '项目列表' }, { id: 'sessions', label: '会话列表' }] as const}
          />
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsResetConfirmOpen(true)} disabled={isSyncing}>
              {sessions.isResetting ? '重置中…' : '重置'}
            </Button>
            <Button size="sm" onClick={() => void sessions.manualSync()} disabled={isSyncing} aria-busy={isSyncing}>
              <RefreshCw size={13} className={isSyncing ? 'animate-spin motion-reduce:animate-none' : ''} />
              {isSyncing ? '同步中…' : '立即同步'}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 px-[var(--workspace-inset-inline)]">
        <p className="text-caption text-[var(--label)]">
          {sessions.isResetting ? (
            '正在重置并重新同步会话…'
          ) : sessions.status?.lastSyncedAt ? (
            <>
              上次同步 {formatRelativeTime(sessions.status.lastSyncedAt)}
              {sessions.status.nextSyncAt && !isSyncing && (
                <> · 下次同步 {formatDateTime(sessions.status.nextSyncAt)}</>
              )}
            </>
          ) : (
            '尚未同步 · 每 5 分钟自动同步'
          )}
        </p>

        <div
          className="flex items-center gap-2 text-label text-muted-foreground"
          title="子会话仍会同步并计入总用量，此开关仅控制列表显示范围"
        >
          <span>包含子会话</span>
          <ToggleSwitch
            size="sm"
            label="包含子会话"
            checked={includeSubagents}
            onToggle={() => setIncludeSubagents(value => !value)}
          />
        </div>
      </div>

      {isSyncing && (
        <div className="mb-3 shrink-0 px-[var(--workspace-inset-inline)]">
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="会话同步进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={syncPercent}
              className="h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--button-fill)]"
            >
              <div
                className={`h-full rounded-full bg-primary ${syncPercent === undefined ? 'w-1/3 animate-pulse motion-reduce:animate-none' : 'transition-[width] duration-300 motion-reduce:transition-none'}`}
                style={syncPercent === undefined ? undefined : { width: `${Math.max(2, syncPercent)}%` }}
              />
            </div>
            <span className="shrink-0 text-caption text-[var(--label)] tabular-nums">
              {sessions.syncProgress
                ? `正在同步 ${sessions.syncProgress.done}/${sessions.syncProgress.total}`
                : sessions.isResetting
                  ? '正在准备重置并重新同步…'
                  : '正在扫描会话…'}
            </span>
          </div>
        </div>
      )}

      {sessions.error && (
        <div className="mb-3 shrink-0 px-[var(--workspace-inset-inline)]">
          <div className="bento-card px-4 py-2.5 text-label text-destructive">
            {sessions.error}
          </div>
        </div>
      )}

      <div className="page-scroll flex flex-col">
        {view.type === 'sessions' ? (
          <SessionListView
            includeSubagents={includeSubagents}
            refreshKey={sessions.syncResult?.syncedAt ?? null}
            onOpenDetail={setDetailSession}
            onRevealInFinder={handleRevealInFinder}
          />
        ) : view.type === 'projects' ? (
          <ProjectsView
            includeSubagents={includeSubagents}
            projects={filteredProjects}
            totalProjects={sessions.projects.length}
            totalSessions={sessions.projects.reduce((total, project) => total + project.sessionCount, 0)}
            search={search}
            onSearchChange={setSearch}
            isLoading={sessions.isLoading}
            isSyncing={isSyncing}
            onOpenProject={openProject}
            onSyncNow={() => void sessions.manualSync()}
          />
        ) : (
          <ProjectSessionsView
            key={view.project.path}
            project={
              sessions.projects.find(project => project.path === currentProjectPath)
              ?? { ...view.project, sessionCount: 0, totalTokens: 0, lastSessionAt: null }
            }
            sessions={sessions.sessions}
            includeSubagents={includeSubagents}
            isLoading={sessions.isLoadingSessions}
            onBack={goBack}
            onOpenDetail={setDetailSession}
            onRevealInFinder={handleRevealInFinder}
          />
        )}
      </div>

      <ConfirmModal
        isOpen={isResetConfirmOpen}
        title="重置已同步会话？"
        message="将清空已同步的会话、项目列表和用量统计，再重新导入本地全部会话（包含归档）。本地会话文件、账号和配置会保留，重新同步可能需要一些时间。"
        confirmLabel="重置并重新同步"
        confirmDisabled={isSyncing}
        onCancel={() => setIsResetConfirmOpen(false)}
        onConfirm={() => {
          if (isSyncing) return;
          setIsResetConfirmOpen(false);
          void sessions.resetAndSync();
        }}
      />

      {detailSession && detailContainer && createPortal(
        <SessionDetailPanel
          key={detailSession.id}
          session={detailSession}
          loadContent={sessions.loadSessionContent}
          syncRevision={sessions.syncResult?.syncedAt}
          onRevealInFinder={handleRevealInFinder}
          onClose={() => setDetailSession(null)}
        />,
        detailContainer,
      )}
    </div>
  );
};

interface ProjectsViewProps {
  includeSubagents: boolean;
  projects: SessionProject[];
  totalProjects: number;
  totalSessions: number;
  search: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  isSyncing: boolean;
  onOpenProject: (project: SessionProject) => void;
  onSyncNow: () => void;
}

const ProjectsView: React.FC<ProjectsViewProps> = ({
  includeSubagents,
  projects,
  totalProjects,
  totalSessions,
  search,
  onSearchChange,
  isLoading,
  isSyncing,
  onOpenProject,
  onSyncNow,
}) => {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3.5 flex shrink-0 flex-wrap items-center gap-2.5">
        <span className="rounded-full bg-[var(--button-fill)] px-2.5 py-1 text-caption font-medium text-muted-foreground tabular-nums">
          {totalProjects} 个项目
        </span>
        <span className="rounded-full bg-[var(--button-fill)] px-2.5 py-1 text-caption font-medium text-muted-foreground tabular-nums">
          {totalSessions} 个{includeSubagents ? '会话' : '主会话'}
        </span>
        <div className="ml-auto flex w-full @min-[520px]/page:w-60">
          <SearchInput
            value={search}
            onChange={onSearchChange}
            label="搜索项目"
            placeholder="搜索项目名称或路径…"
          />
        </div>
      </div>

      {isLoading && !isSyncing ? (
        <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1160px]/page:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-[132px] rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="bento-empty flex-1 py-16">
          <div className="mb-3.5 grid size-11 place-items-center rounded-[12px] bg-[var(--button-fill)] text-muted-foreground">
            <Clock size={20} />
          </div>
          <h3 className="mb-1.5 text-title font-semibold text-foreground">
            {search.trim() ? '没有找到匹配的项目' : isSyncing ? '正在同步会话数据…' : '还没有会话数据'}
          </h3>
          <p className="mb-5 text-body text-muted-foreground">
            {search.trim()
              ? '试试其他项目名称或路径，或清除搜索查看全部项目'
              : isSyncing
                ? '首次使用会将 ~/.codex/sessions 的全部历史会话入库，请稍候'
                : '点击同步，将 ~/.codex/sessions 的历史会话按项目入库'}
          </p>
          {!isSyncing && !search.trim() && (
            <Button size="sm" onClick={onSyncNow}>
              立即同步
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1160px]/page:grid-cols-3 gap-4">
          {projects.map(project => (
            <ProjectCard key={project.path} project={project} onOpen={onOpenProject} />
          ))}
        </div>
      )}
    </div>
  );
};

interface ProjectSessionsViewProps {
  includeSubagents: boolean;
  project: SessionProject;
  sessions: SessionRecord[];
  isLoading: boolean;
  onBack: () => void;
  onOpenDetail: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
}

const ProjectSessionsView: React.FC<ProjectSessionsViewProps> = ({
  includeSubagents,
  project,
  sessions,
  isLoading,
  onBack,
  onOpenDetail,
  onRevealInFinder,
}) => {
  const [search, setSearch] = useState('');
  const keyword = search.trim().toLowerCase();
  const sessionLabel = includeSubagents ? '会话' : '主会话';
  const filteredSessions = useMemo(
    () => (keyword ? sessions.filter(session => session.id.toLowerCase().includes(keyword)) : sessions),
    [sessions, keyword],
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3.5 shrink-0 space-y-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回项目列表"
            title="返回项目列表"
            className="button-neutral grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-foreground"
          >
            <ChevronLeft aria-hidden="true" size={14} />
          </button>
          <h3 className="max-w-[45%] shrink-0 truncate text-title font-semibold tracking-[-0.01em] text-foreground" title={project.name}>
            {project.name}
          </h3>
          <span aria-hidden="true" className="text-label text-[var(--label)]">/</span>
          <p className="min-w-0 flex-1 truncate font-mono text-caption text-[var(--label)]" title={project.path}>
            {project.path}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-caption text-[var(--label)]">
          <span role="status">
            {isLoading
              ? '正在加载…'
              : keyword
                ? `${filteredSessions.length} 个匹配 / 共 ${sessions.length} 个${sessionLabel}`
                : `${sessions.length} 个${sessionLabel}`}
          </span>
          {project.totalTokens > 0 && <span>· {formatTokens(project.totalTokens)} tokens</span>}
          {project.lastSessionAt && (
            <span title={formatDateTime(project.lastSessionAt)}>· 最近活跃 {formatRelativeTime(project.lastSessionAt)}</span>
          )}
          <div className="ml-auto flex w-full @min-[520px]/page:w-60">
            <SearchInput value={search} onChange={setSearch} label="搜索项目内会话 ID" placeholder="搜索会话 ID…" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
          ))}
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bento-empty flex-1 py-14">
          <p className="text-body text-muted-foreground">
            {keyword ? '没有找到匹配的会话，试试更短的 ID 片段' : `该项目暂无${sessionLabel}`}
          </p>
          {!includeSubagents && (
            <p className="mt-2 text-label text-[var(--label)]">开启“包含子会话”可查看子会话</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              search={keyword}
              onOpenDetail={onOpenDetail}
              onRevealInFinder={onRevealInFinder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SessionsPage;
