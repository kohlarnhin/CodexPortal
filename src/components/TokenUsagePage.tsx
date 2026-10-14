import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DailyTokenUsage, ModelTokenUsage, ProjectTokenUsage } from '../types/session';
import { formatTokens } from '../utils/format';
import { calcModelCost, formatCost } from '../utils/modelPricing';
import { DateRangePicker } from './DatePicker';
import SegmentedControl from './SegmentedControl';
import { cn } from '../lib/utils';
import PageHeader from './ui/page-header';

function toDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayStr(): string {
  return toDateStr(new Date());
}

function daysAgoStr(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateStr(date);
}

interface StatCardDetail {
  label: string;
  value: string;
  highlight?: boolean;
}

interface StatCardProps {
  label: string;
  value: string;
  details?: StatCardDetail[];
  subtext?: React.ReactNode;
  icon?: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, details, subtext, icon }) => (
  <div className="flex flex-col justify-between rounded-xl border bg-card p-4 shadow-xs">
    <div className="flex items-center justify-between gap-1.5 mb-1.5">
      <span className="text-[12.5px] text-muted-foreground truncate">{label}</span>
      {icon && <div className="text-muted-foreground shrink-0">{icon}</div>}
    </div>
    <div>
      <div className="text-[22px] font-semibold tracking-tight text-foreground tabular-nums leading-tight">
        {value}
      </div>
      {details && details.length > 0 ? (
        <div className="mt-3 pt-2.5 border-t flex flex-col gap-1 text-[11.5px]">
          {details.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-2" title={`${d.label}: ${d.value}`}>
              <span className="text-muted-foreground shrink-0 select-none">{d.label}</span>
              <span
                className={cn(
                  'tabular-nums truncate text-right',
                  d.highlight ? 'text-emerald-600 font-medium' : 'text-foreground'
                )}
              >
                {d.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-muted-foreground min-h-[16px]">
          {subtext || '\u00A0'}
        </div>
      )}
    </div>
  </div>
);

interface DistributionItemProps {
  rank: number;
  label: string;
  sublabel?: string;
  value: number;
  max: number;
  total: number;
  iconType: 'project' | 'model';
}

const DistributionItem: React.FC<DistributionItemProps> = ({
  rank,
  label,
  sublabel,
  value,
  max,
  total,
  iconType,
}) => {
  const relativePercent = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  const sharePercent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="group rounded-md p-2 transition-colors hover:bg-muted/60 flex flex-col gap-1.5">
      {/* 头部行：序号 + 图标 + 项目/模型全名（独占空间，不被挤压截断） + Token用量 */}
      <div className="flex items-center justify-between gap-2.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-medium tabular-nums text-muted-foreground bg-muted">
            {rank}
          </span>
          <div className="shrink-0 text-muted-foreground">
            {iconType === 'project' ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z" />
                <path d="M9 13v2" />
                <path d="M15 13v2" />
              </svg>
            )}
          </div>
          <span
            className={cn(
              'truncate text-[13px] font-medium text-foreground select-text leading-tight',
              iconType === 'model' && 'font-mono text-[12.5px]'
            )}
            title={label}
          >
            {label}
          </span>
        </div>
        <span className="text-[13px] font-medium text-foreground tabular-nums shrink-0">
          {formatTokens(value)}
        </span>
      </div>

      {/* 第二行：与名称左对齐的细进度条 + 会话数与占比信息 */}
      <div className="flex items-center gap-3 pl-7">
        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-primary/10">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${relativePercent}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {sublabel && <span>{sublabel}</span>}
          {sublabel && <span className="text-neutral-300">·</span>}
          <span className="font-medium text-foreground">{sharePercent}%</span>
        </div>
      </div>
    </div>
  );
};

const TokenUsagePage: React.FC = () => {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [allDates, setAllDates] = useState(false);
  const [days, setDays] = useState<DailyTokenUsage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryStartDate = allDates ? null : startDate;
  const queryEndDate = allDates ? null : endDate;

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    const unlisteners: Array<() => void> = [];
    const load = async () => {
      if (disposed) return;
      const currentRequest = ++requestId;
      setIsLoading(true);
      setError(null);
      try {
        const data = await invoke<DailyTokenUsage[]>('get_token_usage', {
          startDate: queryStartDate,
          endDate: queryEndDate,
        });
        if (!disposed && currentRequest === requestId) setDays(data);
      } catch (err: any) {
        if (!disposed && currentRequest === requestId) {
          console.error('Failed to load token usage:', err);
          setDays([]);
          setError(err?.toString() || 'Failed to load token usage');
        }
      } finally {
        if (!disposed && currentRequest === requestId) setIsLoading(false);
      }
    };

    for (const event of ['session-sync-completed', 'session-sync-failed', 'sessions-reset']) {
      void listen(event, () => {
        if (disposed) return;
        if (event === 'sessions-reset') setDays([]);
        void load();
      }).then(stop => {
        if (disposed) stop();
        else unlisteners.push(stop);
      }).catch(err => console.error('Failed to listen for session sync:', err));
    }
    void load();
    return () => {
      disposed = true;
      unlisteners.forEach(stop => stop());
    };
  }, [queryStartDate, queryEndDate]);

  const totals = useMemo(
    () =>
      days.reduce(
        (acc, day) => ({
          totalTokens: acc.totalTokens + day.totalTokens,
          inputTokens: acc.inputTokens + day.inputTokens,
          cachedInputTokens: acc.cachedInputTokens + day.cachedInputTokens,
          outputTokens: acc.outputTokens + day.outputTokens,
          reasoningTokens: acc.reasoningTokens + day.reasoningTokens,
        }),
        { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      ),
    [days],
  );

  // 输入缓存率：缓存命中占比（输入为 0 时为 0）。
  const cacheRate = totals.inputTokens > 0
    ? Math.min(100, (totals.cachedInputTokens / totals.inputTokens) * 100)
    : 0;

  // 多天查询时把每天的项目/模型分布合并为范围聚合。
  const mergedProjects = useMemo(() => {
    const map = new Map<string, ProjectTokenUsage>();
    for (const day of days) {
      for (const project of day.projects) {
        const existing = map.get(project.projectPath);
        if (existing) {
          existing.totalTokens += project.totalTokens;
          existing.sessionCount += project.sessionCount;
        } else {
          map.set(project.projectPath, { ...project });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  }, [days]);

  const mergedModels = useMemo(() => {
    const map = new Map<string, ModelTokenUsage>();
    for (const day of days) {
      for (const model of day.models) {
        const existing = map.get(model.model);
        if (existing) {
          existing.totalTokens += model.totalTokens;
          existing.sessionCount += model.sessionCount;
          existing.inputTokens += model.inputTokens;
          existing.cachedInputTokens += model.cachedInputTokens;
          existing.outputTokens += model.outputTokens;
          existing.reasoningTokens += model.reasoningTokens;
        } else {
          map.set(model.model, { ...model });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  }, [days]);

  const maxProjectTokens = mergedProjects[0]?.totalTokens ?? 0;
  const maxModelTokens = mergedModels[0]?.totalTokens ?? 0;

  // 消耗金额：按内置 API 单价及模型倍率实时计算，覆盖所选范围内的历史记录。
  const totalCost = useMemo(() => {
    let cost = 0;
    for (const model of mergedModels) {
      const modelCost = calcModelCost(model.model, {
        input: model.inputTokens,
        cachedInput: model.cachedInputTokens,
        output: model.outputTokens,
        reasoning: model.reasoningTokens,
      });
      if (modelCost !== null) cost += modelCost;
    }
    return cost;
  }, [mergedModels]);

  const setRange = (start: string, end: string) => {
    setAllDates(false);
    setStartDate(start);
    setEndDate(end);
  };

  const activeQuickRange = useMemo(() => {
    if (allDates) return 'all';
    const today = todayStr();
    if (startDate === today && endDate === today) return 'today';
    if (startDate === daysAgoStr(6) && endDate === today) return '7days';
    if (startDate === daysAgoStr(29) && endDate === today) return '30days';
    return null;
  }, [startDate, endDate, allDates]);

  return (
    <div className="page-layout pt-4">
      {/* 标题栏 + 日期控制 */}
      <PageHeader
        title="Token 用量"
        description="按天统计会话消耗，支持任意历史日期查询与费用估算"
        actions={
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            allDates={allDates}
            onChange={(start, end) => setRange(start, end)}
          />
          <SegmentedControl<'today' | '7days' | '30days' | 'all'>
            size="sm"
            value={activeQuickRange}
            onChange={key => {
              if (key === 'today') setRange(todayStr(), todayStr());
              else if (key === '7days') setRange(daysAgoStr(6), todayStr());
              else if (key === '30days') setRange(daysAgoStr(29), todayStr());
              else if (key === 'all') setAllDates(true);
            }}
            options={[
              { id: 'today', label: '今天' },
              { id: '7days', label: '近 7 天' },
              { id: '30days', label: '近 30 天' },
              { id: 'all', label: '全部' },
            ]}
          />
        </div>
        }
      />

      {error && (
        <div className="mb-3 shrink-0 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      {/* 页面主视图：固定高度不溢出，无外层滚动条 */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
        {isLoading ? (
          <div className="grid grid-cols-2 @min-[640px]/page:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="flex-1 min-h-[260px] rounded-xl border border-dashed flex items-center justify-center">
            <p className="text-[13px] text-muted-foreground">该时间段暂无 token 用量数据（同步完成后可见）</p>
          </div>
        ) : (
          <>
            {/* 统计卡片：统一四宫格标准 */}
            <div className="grid grid-cols-2 @min-[640px]/page:grid-cols-4 gap-3 shrink-0">
              <StatCard
                label="合计 Token"
                value={formatTokens(totals.totalTokens)}
                details={[
                  { label: '输入总计', value: formatTokens(totals.inputTokens) },
                  { label: '输出总计', value: formatTokens(totals.outputTokens) },
                ]}
                icon={
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                }
              />
              <StatCard
                label="输入 Token"
                value={formatTokens(totals.inputTokens)}
                details={[
                  { label: '缓存命中', value: formatTokens(totals.cachedInputTokens) },
                  {
                    label: '缓存命中率',
                    value: `${cacheRate.toFixed(1)}%`,
                    highlight: cacheRate > 0,
                  },
                ]}
                icon={
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
                  </svg>
                }
              />
              <StatCard
                label="输出 Token"
                value={formatTokens(totals.outputTokens)}
                details={[
                  { label: '思考推理', value: formatTokens(totals.reasoningTokens) },
                  {
                    label: '正文补全',
                    value: formatTokens(Math.max(0, totals.outputTokens - totals.reasoningTokens)),
                  },
                ]}
                icon={
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 9-6 6m0 0 6 6m-6-6h12a6 6 0 0 0 0-12h-3" />
                  </svg>
                }
              />
              <StatCard
                label="预估费用"
                value={formatCost(totalCost)}
                details={[
                  { label: '计费说明', value: 'API 标准价，Astra ×2' },
                  { label: '涉及模型', value: `${mergedModels.length} 个模型` },
                ]}
                icon={
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                    <path d="M12 6v2m0 8v2" />
                  </svg>
                }
              />
            </div>

            {/* 双栏分布看板：自适应填满剩余空间，仅各卡片内部超出时滚动 */}
            <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 gap-3.5 flex-1 min-h-0 pb-0.5">
              {/* 按项目分布 */}
              <div className="flex flex-col rounded-xl border bg-card p-4 shadow-xs min-h-0">
                <div className="flex items-center justify-between pb-3 mb-2 border-b shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-foreground">按项目分布</h3>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                      {mergedProjects.length}
                    </span>
                  </div>
                  <span className="text-[11.5px] text-muted-foreground">消耗占比</span>
                </div>
                {mergedProjects.length === 0 ? (
                  <div className="flex-1 min-h-[140px] flex items-center justify-center">
                    <p className="text-[12px] text-muted-foreground">暂无项目数据</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1 -mr-1.5 pr-1.5">
                    {mergedProjects.map((project, idx) => (
                      <DistributionItem
                        key={project.projectPath}
                        rank={idx + 1}
                        label={project.name}
                        sublabel={`${project.sessionCount} 会话`}
                        value={project.totalTokens}
                        max={maxProjectTokens}
                        total={totals.totalTokens}
                        iconType="project"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 按模型分布 */}
              <div className="flex flex-col rounded-xl border bg-card p-4 shadow-xs min-h-0">
                <div className="flex items-center justify-between pb-3 mb-2 border-b shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-foreground">按模型分布</h3>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                      {mergedModels.length}
                    </span>
                  </div>
                  <span className="text-[11.5px] text-muted-foreground">消耗占比</span>
                </div>
                {mergedModels.length === 0 ? (
                  <div className="flex-1 min-h-[140px] flex items-center justify-center">
                    <p className="text-[12px] text-muted-foreground">暂无模型数据</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1 -mr-1.5 pr-1.5">
                    {mergedModels.map((model, idx) => (
                      <DistributionItem
                        key={model.model}
                        rank={idx + 1}
                        label={model.model}
                        sublabel={`${model.sessionCount} 会话`}
                        value={model.totalTokens}
                        max={maxModelTokens}
                        total={totals.totalTokens}
                        iconType="model"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TokenUsagePage;
