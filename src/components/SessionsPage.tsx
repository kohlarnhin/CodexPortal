import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useSessions } from '../hooks/useSessions';
import { SessionProject, SessionRecord } from '../types/session';
import { formatDateTime, formatRelativeTime } from '../utils/time';
import { formatTokens } from '../utils/format';
import { copyText } from '../utils/clipboard';
import ProjectCard from './sessions/ProjectCard';
import SessionRow from './sessions/SessionRow';
import SessionDetailPanel from './sessions/SessionDetailPanel';
import SessionListView from './sessions/SessionListView';
import SearchInput from './sessions/SearchInput';

type ViewState =
  | { type: 'projects' }
  | { type: 'sessions' }
  | { type: 'project'; project: SessionProject };

interface SessionsPageProps {
  detailContainer: HTMLElement | null;
}

const SessionsPage: React.FC<SessionsPageProps> = ({ detailContainer }) => {
  const sessions = useSessions();
  const [view, setView] = useState<ViewState>({ type: 'projects' });
  const [search, setSearch] = useState('');
  const [detailSession, setDetailSession] = useState<SessionRecord | null>(null);

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

  const handleCopyResume = async (session: SessionRecord) => {
    const ok = await copyText(`codex resume ${session.id}`);
    if (!ok) alert('复制失败，请手动复制');
  };

  const handleRevealInFinder = async (session: SessionRecord) => {
    try {
      await revealItemInDir(session.filePath);
    } catch (err: any) {
      alert(`无法在 Finder 中打开：${err?.toString() || '未知错误'}`);
    }
  };

  const isSyncing = sessions.isSyncing || sessions.syncProgress !== null;

  return (
    <div
      className="page-layout pt-4"
      style={{ visibility: detailSession && detailContainer ? 'hidden' : undefined }}
    >
      {/* 标题栏 + 同步状态 */}
      <div className="page-header mb-4">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">会话管理</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#999999]">
            {sessions.status?.lastSyncedAt ? (
              <>
                上次同步 {formatRelativeTime(sessions.status.lastSyncedAt)}
                {sessions.status.nextSyncAt && !isSyncing && (
                  <> · 下次同步 {formatDateTime(sessions.status.nextSyncAt)}</>
                )}
              </>
            ) : (
              '尚未同步 · 每 5 分钟自动同步'
            )}
          </span>
          <button
            onClick={() => void sessions.manualSync()}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-1.5 bg-black hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={sessions.isSyncing ? 'animate-spin' : ''}
            >
              <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
              <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
            </svg>
            {sessions.isSyncing ? '同步中…' : '立即同步'}
          </button>
        </div>
      </div>

      {/* 同步进度条 */}
      {isSyncing && (
        <div className="mb-4 shrink-0">
          {sessions.syncProgress ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[#EAEAEA]">
                <div
                  className="h-full rounded-full bg-black transition-all duration-300"
                  style={{
                    width: `${Math.max(2, Math.round((sessions.syncProgress.done / Math.max(1, sessions.syncProgress.total)) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-[11px] text-[#666666] shrink-0">
                正在同步 {sessions.syncProgress.done}/{sessions.syncProgress.total}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-[#666666]">
              <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              正在扫描 sessions 目录…
            </div>
          )}
        </div>
      )}

      {sessions.error && (
        <div className="mb-4 shrink-0 rounded-lg border border-[#F3D1D1] bg-[#FFF5F5] px-4 py-2.5 text-[12px] text-[#B3261E]">
          {sessions.error}
        </div>
      )}

      <div className="flex items-center gap-1 mb-4 shrink-0 border-b border-[#EAEAEA]" aria-label="会话浏览方式">
        {([{ type: 'projects', label: '项目列表' }, { type: 'sessions', label: '会话列表' }] as const).map(tab => {
          const isActive = tab.type === 'sessions' ? view.type === 'sessions' : view.type !== 'sessions';
          return (
            <button
              key={tab.type}
              aria-pressed={isActive}
              onClick={() => {
                sessions.activeProjectPathRef.current = null;
                setView({ type: tab.type });
              }}
              className={`px-4 py-2.5 -mb-px border-b-2 text-[13px] font-medium transition-colors ${isActive ? 'border-black text-black' : 'border-transparent text-[#888888] hover:text-black'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="page-scroll">
        {view.type === 'sessions' ? (
          <SessionListView
            refreshKey={sessions.syncResult?.syncedAt ?? null}
            onOpenDetail={setDetailSession}
            onCopyResume={handleCopyResume}
            onRevealInFinder={handleRevealInFinder}
          />
        ) : view.type === 'projects' ? (
          <ProjectsView
            projects={filteredProjects}
            totalProjects={sessions.status?.totalProjects ?? filteredProjects.length}
            totalSessions={sessions.status?.totalSessions ?? 0}
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
            project={view.project}
            sessions={sessions.sessions}
            isLoading={sessions.isLoadingSessions}
            onBack={goBack}
            onOpenDetail={setDetailSession}
            onCopyResume={handleCopyResume}
            onRevealInFinder={handleRevealInFinder}
          />
        )}
      </div>

      {detailSession && detailContainer && createPortal(
        <SessionDetailPanel
          key={detailSession.id}
          session={detailSession}
          loadContent={sessions.loadSessionContent}
          onCopyResume={handleCopyResume}
          onRevealInFinder={handleRevealInFinder}
          onClose={() => setDetailSession(null)}
        />,
        detailContainer,
      )}
    </div>
  );
};

interface ProjectsViewProps {
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
    <div>
      {/* 统计 + 搜索 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="rounded-full border border-[#EAEAEA] bg-white px-3 py-1 text-[11px] font-medium text-[#666666]">
          {totalProjects} 个项目
        </span>
        <span className="rounded-full border border-[#EAEAEA] bg-white px-3 py-1 text-[11px] font-medium text-[#666666]">
          {totalSessions} 个会话
        </span>
        <div className="ml-auto flex w-full @min-[520px]/page:w-56">
          <SearchInput
            value={search}
            onChange={onSearchChange}
            label="搜索项目"
            placeholder="搜索项目名称或路径…"
          />
        </div>
      </div>

      {isLoading && !isSyncing ? (
        <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1024px]/page:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-white border border-[#EAEAEA] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#EAEAEA] py-16 px-8 text-center">
          <div className="w-14 h-14 mx-auto bg-[#F5F5F5] rounded-xl flex items-center justify-center border border-[#EAEAEA] mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#999999]"><path d="M12 8v4l2.5 2.5"/><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <h3 className="text-[16px] font-semibold text-black mb-1.5">
            {search.trim() ? '没有找到匹配的项目' : isSyncing ? '正在同步会话数据…' : '还没有会话数据'}
          </h3>
          <p className="text-[13px] text-[#888888] mb-5">
            {search.trim()
              ? '试试其他项目名称或路径，或清除搜索查看全部项目'
              : isSyncing
              ? '首次使用会将 ~/.codex/sessions 的全部历史会话入库，请稍候'
              : '点击同步，将 ~/.codex/sessions 的历史会话按项目入库'}
          </p>
          {!isSyncing && !search.trim() && (
            <button
              onClick={onSyncNow}
              className="px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
            >
              立即同步
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1024px]/page:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-4">
          {projects.map(project => (
            <ProjectCard key={project.path} project={project} onOpen={onOpenProject} />
          ))}
        </div>
      )}
    </div>
  );
};

interface ProjectSessionsViewProps {
  project: SessionProject;
  sessions: SessionRecord[];
  isLoading: boolean;
  onBack: () => void;
  onOpenDetail: (session: SessionRecord) => void;
  onCopyResume: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
}

const ProjectSessionsView: React.FC<ProjectSessionsViewProps> = ({
  project,
  sessions,
  isLoading,
  onBack,
  onOpenDetail,
  onCopyResume,
  onRevealInFinder,
}) => {
  const [search, setSearch] = useState('');
  const keyword = search.trim().toLowerCase();
  const filteredSessions = useMemo(
    () => keyword ? sessions.filter(session => session.id.toLowerCase().includes(keyword)) : sessions,
    [sessions, keyword],
  );

  return (
    <div>
      {/* 返回 + 项目信息 */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] font-medium text-[#666666] hover:text-black transition-colors mb-4"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        返回项目列表
      </button>

      <div className="bg-white rounded-xl border border-[#EAEAEA] px-5 py-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-black text-white flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16px] font-semibold text-black tracking-tight" title={project.name}>{project.name}</h3>
            <p className="text-[11px] font-mono text-[#888888] truncate">{project.path}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <span className="rounded-full bg-[#F5F5F5] border border-[#EAEAEA] px-2.5 py-0.5 text-[11px] font-medium text-[#666666]">
              {sessions.length} 个会话
              {project.totalTokens > 0 && (
                <> · {formatTokens(project.totalTokens)} tokens</>
              )}
            </span>
            <span className="rounded-full bg-[#F5F5F5] border border-[#EAEAEA] px-2.5 py-0.5 text-[11px] font-medium text-[#666666]">
              最近活跃 {formatRelativeTime(project.lastSessionAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span role="status" className="text-[11px] text-[#888888]">
          {isLoading ? '正在加载…' : keyword ? `${filteredSessions.length} 个匹配会话 / 共 ${sessions.length} 个` : `共 ${sessions.length} 个会话`}
        </span>
        <div className="ml-auto flex w-full @min-[520px]/page:w-72">
          <SearchInput value={search} onChange={setSearch} label="搜索项目内会话 ID" placeholder="搜索会话 ID，支持部分匹配…" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-white border border-[#EAEAEA] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#EAEAEA] py-14 px-8 text-center">
          <p className="text-[13px] text-[#999999]">{keyword ? '没有找到匹配的会话，试试更短的 ID 片段' : '该项目暂无会话'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              search={keyword}
              onOpenDetail={onOpenDetail}
              onCopyResume={onCopyResume}
              onRevealInFinder={onRevealInFinder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SessionsPage;
