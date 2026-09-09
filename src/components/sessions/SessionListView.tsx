import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SessionListPage, SessionRecord } from '../../types/session';
import SearchInput from './SearchInput';
import SessionRow from './SessionRow';

const PAGE_SIZE = 50;

interface SessionListViewProps {
  refreshKey: string | null;
  onOpenDetail: (session: SessionRecord) => void;
  onCopyResume: (session: SessionRecord) => void;
  onRevealInFinder: (session: SessionRecord) => void;
}

interface ListResult {
  key: string;
  data: SessionListPage | null;
  error: string | null;
}

const SessionListView: React.FC<SessionListViewProps> = ({
  refreshKey, onOpenDetail, onCopyResume, onRevealInFinder,
}) => {
  const [{ search, page }, setQuery] = useState({ search: '', page: 0 });
  const [result, setResult] = useState<ListResult | null>(null);
  const [retry, setRetry] = useState(0);
  const keyword = search.trim();
  const requestKey = JSON.stringify([keyword, page, refreshKey, retry]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const data = await invoke<SessionListPage>('list_sessions', {
          search: keyword, offset: page * PAGE_SIZE, limit: PAGE_SIZE,
        });
        if (cancelled) return;
        const lastPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);
        if (page > lastPage) {
          setQuery(current => ({ ...current, page: lastPage }));
          return;
        }
        setResult({ key: requestKey, data, error: null });
      } catch (error) {
        if (!cancelled) {
          setResult({ key: requestKey, data: null, error: String(error) || '加载会话列表失败' });
        }
      }
    }, keyword ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword, page, requestKey]);

  // 输入或同步变化后立即隐藏旧结果，迟到的请求也不会覆盖当前查询。
  const isLoading = result?.key !== requestKey;
  const data = isLoading ? null : result?.data;
  const error = isLoading ? null : result?.error;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-black">全部项目的会话</p>
          <p className="mt-1 text-[11px] text-[#888888]">按开始时间倒序排列，支持输入完整或部分会话 ID</p>
        </div>
        <div className="ml-auto flex w-full items-center gap-3 @min-[640px]/page:w-auto">
          <span role="status" className="shrink-0 text-[11px] text-[#888888]">
            {isLoading ? '正在查找…' : error ? '加载失败' : `${data?.total ?? 0} 个${keyword ? '匹配' : ''}会话`}
          </span>
          <div className="flex min-w-0 flex-1 @min-[640px]/page:w-72">
            <SearchInput
              value={search}
              onChange={value => setQuery({ search: value, page: 0 })}
              label="搜索会话 ID"
              placeholder="搜索会话 ID，支持部分匹配…"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-label="正在加载会话列表" aria-busy="true">
          {[1, 2, 3].map(index => <div key={index} className="h-28 bg-white border border-[#EAEAEA] rounded-xl animate-pulse" />)}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-[#F3D1D1] bg-[#FFF5F5] px-5 py-8 text-center">
          <p className="text-[13px] text-[#B3261E]">{error}</p>
          <button onClick={() => setRetry(value => value + 1)} className="mt-3 text-[13px] font-medium text-black underline underline-offset-4">重新加载</button>
        </div>
      ) : !data?.sessions.length ? (
        <div className="bg-white rounded-xl border border-[#EAEAEA] py-14 px-8 text-center">
          <p className="text-[14px] font-medium text-black">{keyword ? '没有找到匹配的会话' : '还没有会话数据'}</p>
          <p className="mt-2 text-[12px] text-[#888888]">{keyword ? '试试更短的 ID 片段，或清除搜索查看全部会话' : '点击上方“立即同步”，导入本地历史会话'}</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data.sessions.map(session => (
              <SessionRow
                key={session.id}
                session={session}
                search={keyword}
                showProject
                onOpenDetail={onOpenDetail}
                onCopyResume={onCopyResume}
                onRevealInFinder={onRevealInFinder}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-[12px] text-[#888888]">
              <span>第 {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + data.sessions.length} 条，共 {data.total} 条</span>
              <div className="flex items-center gap-3">
                <button
                  disabled={page === 0}
                  onClick={() => setQuery(current => ({ ...current, page: current.page - 1 }))}
                  className="rounded-md border border-[#EAEAEA] bg-white px-3 py-1.5 text-[#555555] hover:border-[#AAAAAA] disabled:opacity-40 disabled:cursor-not-allowed"
                >上一页</button>
                <span>{page + 1} / {totalPages}</span>
                <button
                  disabled={page + 1 >= totalPages}
                  onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))}
                  className="rounded-md border border-[#EAEAEA] bg-white px-3 py-1.5 text-[#555555] hover:border-[#AAAAAA] disabled:opacity-40 disabled:cursor-not-allowed"
                >下一页</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SessionListView;
