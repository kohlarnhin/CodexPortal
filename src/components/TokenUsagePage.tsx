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
import { buildSeriesTrend, buildTrendBuckets, GRANULARITY_LABEL, SeriesTrendChart, TotalTrendChart } from './TokenTrendCharts';
import { ActionTooltip } from './ui/tooltip';
import { ArrowDownLeft, ArrowUpRight, Bot, ChartColumnStacked, CircleDollarSign, Folder, List, Sigma } from 'lucide-react';

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

type InsightView = 'trend' | 'projects' | 'models';

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
  <section className="bento-card flex flex-col justify-between overflow-hidden">
    <div className="px-4 pt-3.5 pb-3">
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <span className="truncate text-label text-[var(--label)]">{label}</span>
        {icon && <div className="shrink-0 text-[var(--label)]">{icon}</div>}
      </div>
      <div className="text-stat font-semibold leading-tight tracking-[-0.02em] text-foreground tabular-nums">
        {value}
      </div>
    </div>

    {details && details.length > 0 ? (
      <div className="flex flex-col gap-1 border-t border-[var(--hairline-divider)] px-4 py-2.5 text-caption">
        {details.map((d, i) => (
          <div key={i} className="flex items-center justify-between gap-2" title={`${d.label}: ${d.value}`}>
            <span className="shrink-0 text-[var(--label)] select-none">{d.label}</span>
            <span
              className={cn(
                'truncate text-right tabular-nums',
                d.highlight ? 'font-medium text-success' : 'text-foreground',
              )}
            >
              {d.value}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <div className="min-h-[16px] px-4 pb-3 text-caption text-[var(--label)]">
        {subtext || '\u00A0'}
      </div>
    )}
  </section>
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
    <div className="flex flex-col gap-1.5 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-[var(--hover)]">
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--button-fill)] text-[10.5px] font-medium text-muted-foreground tabular-nums">
            {rank}
          </span>
          <div className="shrink-0 text-[var(--label)]">
            {iconType === 'project' ? <Folder size={13.5} /> : <Bot size={13.5} />}
          </div>
          <span
            className={cn(
              'truncate text-body font-medium leading-tight text-foreground select-text',
              iconType === 'model' && 'font-mono',
            )}
            title={label}
          >
            {label}
          </span>
        </div>
        <span className="shrink-0 text-body font-semibold text-foreground tabular-nums">
          {formatTokens(value)}
        </span>
      </div>

      <div className="flex items-center gap-3 pl-7">
        <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--button-fill)]">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${relativePercent}%` }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-caption text-[var(--label)] tabular-nums">
          {sublabel && <span>{sublabel}</span>}
          {sublabel && <span>·</span>}
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
  const [insightView, setInsightView] = useState<InsightView>('trend');
  const [distributionMode, setDistributionMode] = useState<'chart' | 'list'>('chart');

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

  const cacheRate = totals.inputTokens > 0
    ? Math.min(100, (totals.cachedInputTokens / totals.inputTokens) * 100)
    : 0;

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

  const trend = useMemo(
    () => buildTrendBuckets(days, queryStartDate, queryEndDate ?? todayStr()),
    [days, queryStartDate, queryEndDate],
  );
  const trendPeak = trend.buckets.reduce<(typeof trend.buckets)[number] | null>(
    (peak, bucket) => (bucket.totalTokens > (peak?.totalTokens ?? 0) ? bucket : peak),
    null,
  );
  const hasTrend = trend.buckets.length >= 2;
  const activeInsightView: InsightView = insightView === 'trend' && !hasTrend ? 'projects' : insightView;
  const showDistributionChart = hasTrend && distributionMode === 'chart';
  const projectTrend = useMemo(
    () => buildSeriesTrend(days, trend.buckets, trend.granularity, 'project'),
    [days, trend],
  );
  const modelTrend = useMemo(
    () => buildSeriesTrend(days, trend.buckets, trend.granularity, 'model'),
    [days, trend],
  );

  const maxProjectTokens = mergedProjects[0]?.totalTokens ?? 0;
  const maxModelTokens = mergedModels[0]?.totalTokens ?? 0;

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
    <div className="page-layout">
      <PageHeader
        title="Token 用量"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              allDates={allDates}
              onChange={(start, end) => setRange(start, end)}
            />
            <SegmentedControl<'today' | '7days' | '30days' | 'all'>
              size="sm"
              label="快捷日期范围"
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

      <div className="page-body gap-3.5 overflow-hidden">
        {error && (
          <div className="bento-card shrink-0 px-4 py-2.5 text-label text-destructive">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 @min-[640px]/page:grid-cols-4 gap-3.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="bento-empty flex-1">
            <p className="text-body text-muted-foreground">该时间段暂无 Token 用量数据（同步完成后可见）</p>
          </div>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-2 @min-[640px]/page:grid-cols-4 gap-3.5">
              <StatCard
                label="合计 Token"
                value={formatTokens(totals.totalTokens)}
                details={[
                  { label: '输入总计', value: formatTokens(totals.inputTokens) },
                  { label: '输出总计', value: formatTokens(totals.outputTokens) },
                ]}
                icon={<Sigma size={14} />}
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
                icon={<ArrowDownLeft size={14} />}
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
                icon={<ArrowUpRight size={14} />}
              />
              <StatCard
                label="预估费用"
                value={formatCost(totalCost)}
                details={[
                  { label: '计费说明', value: 'API 标准价，Astra ×2' },
                  { label: '涉及模型', value: `${mergedModels.length} 个模型` },
                ]}
                icon={<CircleDollarSign size={14} />}
              />
            </div>

            <section className="bento-group flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--hairline-divider)] pb-3">
                <SegmentedControl<InsightView>
                  size="sm"
                  label="统计维度"
                  value={activeInsightView}
                  onChange={setInsightView}
                  options={[
                    ...(hasTrend ? [{ id: 'trend' as const, label: '用量趋势' }] : []),
                    { id: 'projects', label: `按项目 · ${mergedProjects.length}` },
                    { id: 'models', label: `按模型 · ${mergedModels.length}` },
                  ]}
                />
                <div className="flex items-center gap-2.5">
                  <span className="text-caption text-[var(--label)] tabular-nums">
                    {activeInsightView === 'trend'
                      ? trendPeak
                        ? `${GRANULARITY_LABEL[trend.granularity]} · 峰值 ${trendPeak.label} ${formatTokens(trendPeak.totalTokens)}`
                        : GRANULARITY_LABEL[trend.granularity]
                      : showDistributionChart
                        ? `${GRANULARITY_LABEL[trend.granularity]} · 前 5 名单独着色`
                        : '按消耗占比排序'}
                  </span>
                  {activeInsightView !== 'trend' && hasTrend && (
                    <div
                      className="inline-flex items-center rounded-full p-0.5 shadow-[inset_0_0_0_1px_var(--hairline-control)]"
                      role="group"
                      aria-label="展示方式"
                    >
                      {([
                        { id: 'chart', label: '图表', icon: ChartColumnStacked },
                        { id: 'list', label: '排行列表', icon: List },
                      ] as const).map(option => (
                        <ActionTooltip key={option.id} label={option.label}>
                          <button
                            type="button"
                            aria-label={option.label}
                            aria-pressed={distributionMode === option.id}
                            onClick={() => setDistributionMode(option.id)}
                            className={cn(
                              'grid size-6 cursor-pointer place-items-center rounded-full transition-colors',
                              distributionMode === option.id
                                ? 'bg-[var(--button-fill)] text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <option.icon size={12.5} />
                          </button>
                        </ActionTooltip>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {activeInsightView === 'trend' ? (
                <TotalTrendChart buckets={trend.buckets} granularity={trend.granularity} />
              ) : (activeInsightView === 'projects' ? mergedProjects.length : mergedModels.length) === 0 ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-label text-muted-foreground">
                    {activeInsightView === 'projects' ? '暂无项目数据' : '暂无模型数据'}
                  </p>
                </div>
              ) : showDistributionChart ? (
                <SeriesTrendChart
                  key={activeInsightView}
                  buckets={trend.buckets}
                  {...(activeInsightView === 'projects' ? projectTrend : modelTrend)}
                  grandTotal={totals.totalTokens}
                  ariaLabel={activeInsightView === 'projects' ? '按项目堆叠的 Token 用量趋势' : '按模型堆叠的 Token 用量趋势'}
                />
              ) : activeInsightView === 'projects' ? (
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 -mr-1">
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
              ) : (
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 -mr-1">
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
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default TokenUsagePage;
