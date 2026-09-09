import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DailyTokenUsage, ModelTokenUsage, ProjectTokenUsage } from '../types/session';
import { formatTokens } from '../utils/format';
import { calcModelCost, formatCost } from '../utils/modelPricing';
import { DateRangePicker } from './DatePicker';
import SegmentedControl from './SegmentedControl';
import { cn } from '../lib/utils';

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
  <div className="flex flex-col justify-between rounded-xl border border-neutral-200/80 bg-white p-3.5 shadow-2xs transition-all hover:border-neutral-300">
    <div className="flex items-center justify-between gap-1.5 mb-1.5">
      <span className="text-[12px] font-medium text-neutral-500 truncate">{label}</span>
      {icon && <div className="text-neutral-400 shrink-0">{icon}</div>}
    </div>
    <div>
      <div className="font-mono text-[20px] sm:text-[22px] font-bold tracking-tight text-neutral-900 tabular-nums leading-tight">
        {value}
      </div>
      {details && details.length > 0 ? (
        <div className="mt-2.5 pt-2 border-t border-neutral-100 flex flex-col gap-1 text-[11px]">
          {details.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-2" title={`${d.label}: ${d.value}`}>
              <span className="text-neutral-400 shrink-0 select-none">{d.label}</span>
              <span
                className={cn(
                  'font-mono tabular-nums truncate text-right',
                  d.highlight ? 'text-emerald-600 font-semibold' : 'text-neutral-600 font-medium'
                )}
              >
                {d.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-neutral-400 min-h-[16px]">
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
    <div className="group rounded-lg p-2 transition-colors hover:bg-neutral-50/90 flex flex-col gap-1.5">
      {/* 头部行：序号 + 图标 + 项目/模型全名（独占空间，不被挤压截断） + Token用量 */}
      <div className="flex items-center justify-between gap-2.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-mono font-semibold text-neutral-400 group-hover:text-neutral-700 bg-neutral-100/90">
            {rank}
          </span>
          <div className="shrink-0 text-neutral-400 group-hover:text-neutral-600">
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
              'truncate text-[13px] font-medium text-neutral-800 select-text leading-tight',
              iconType === 'model' && 'font-mono text-[12.5px]'
            )}
            title={label}
          >
            {label}
          </span>
        </div>
        <span className="font-mono text-[13px] font-bold text-neutral-900 tabular-nums shrink-0">
          {formatTokens(value)}
        </span>
      </div>

      {/* 第二行：与名称左对齐的细进度条 + 会话数与占比信息 */}
      <div className="flex items-center gap-3 pl-7">
        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-neutral-800 group-hover:bg-neutral-900 transition-all duration-500"
            style={{ width: `${relativePercent}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-neutral-400">
          {sublabel && <span>{sublabel}</span>}
          {sublabel && <span className="text-neutral-300">·</span>}
          <span className="font-semibold text-neutral-600">{sharePercent}%</span>
        </div>
      </div>
    </div>
  );
};

const TokenUsagePage: React.FC = () => {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [days, setDays] = useState<DailyTokenUsage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (start: string, end: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await invoke<DailyTokenUsage[]>('get_token_usage', {
        startDate: start,
        endDate: end,
      });
      setDays(data);
    } catch (err: any) {
      console.error('Failed to load token usage:', err);
      setError(err?.toString() || 'Failed to load token usage');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

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

  // 消耗金额：按内置 API 单价实时计算（任意日期范围，数据来自同步入库的 token 记录）。
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
    setStartDate(start);
    setEndDate(end);
  };

  const activeQuickRange = useMemo(() => {
    const today = todayStr();
    if (startDate === today && endDate === today) return 'today';
    if (startDate === daysAgoStr(6) && endDate === today) return '7days';
    if (startDate === daysAgoStr(29) && endDate === today) return '30days';
    return null;
  }, [startDate, endDate]);

  return (
    <div className="page-layout pt-4">
      {/* 标题栏 + 日期控制 */}
      <div className="page-header mb-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900 mb-1">Token 用量</h2>
          <p className="text-[13px] text-neutral-500">按天统计会话消耗，支持任意历史日期查询与费用估算</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(start, end) => setRange(start, end)}
          />
          <SegmentedControl<'today' | '7days' | '30days'>
            size="sm"
            value={activeQuickRange}
            onChange={key => {
              if (key === 'today') setRange(todayStr(), todayStr());
              else if (key === '7days') setRange(daysAgoStr(6), todayStr());
              else if (key === '30days') setRange(daysAgoStr(29), todayStr());
            }}
            options={[
              { id: 'today', label: '今天' },
              { id: '7days', label: '近 7 天' },
              { id: '30days', label: '近 30 天' },
            ]}
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 shrink-0 rounded-lg border border-red-200 bg-red-50/70 px-4 py-2 text-[12px] text-red-600">
          {error}
        </div>
      )}

      {/* 页面主视图：固定高度不溢出，无外层滚动条 */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
        {isLoading ? (
          <div className="grid grid-cols-2 @min-[640px]/page:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-white border border-neutral-200/80 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="flex-1 min-h-[260px] bg-white rounded-xl border border-neutral-200/80 flex items-center justify-center shadow-2xs">
            <p className="text-[13px] text-neutral-400">该时间段暂无 token 用量数据（同步完成后可见）</p>
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
                  { label: '计费说明', value: '标准牌价估算' },
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
              <div className="flex flex-col rounded-xl border border-neutral-200/80 bg-white p-4 shadow-2xs min-h-0">
                <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-neutral-100 shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13.5px] font-semibold text-neutral-900">按项目分布</h3>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-mono font-medium text-neutral-500">
                      {mergedProjects.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-neutral-400">消耗占比</span>
                </div>
                {mergedProjects.length === 0 ? (
                  <div className="flex-1 min-h-[140px] flex items-center justify-center">
                    <p className="text-[12px] text-neutral-400">暂无项目数据</p>
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
              <div className="flex flex-col rounded-xl border border-neutral-200/80 bg-white p-4 shadow-2xs min-h-0">
                <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-neutral-100 shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13.5px] font-semibold text-neutral-900">按模型分布</h3>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-mono font-medium text-neutral-500">
                      {mergedModels.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-neutral-400">消耗占比</span>
                </div>
                {mergedModels.length === 0 ? (
                  <div className="flex-1 min-h-[140px] flex items-center justify-center">
                    <p className="text-[12px] text-neutral-400">暂无模型数据</p>
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

