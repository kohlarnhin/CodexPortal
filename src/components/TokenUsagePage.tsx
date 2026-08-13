import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DailyTokenUsage, ModelTokenUsage, ProjectTokenUsage } from '../types/session';
import { formatTokens } from '../utils/format';
import { calcModelCost, formatCost } from '../utils/modelPricing';
import DatePicker from './DatePicker';

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

interface DistributionBarProps {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}

const DistributionBar: React.FC<DistributionBarProps> = ({ label, value, max, suffix }) => {
  const percent = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-40 shrink-0 truncate text-[12px] font-medium text-[#444444]" title={label}>
        {label}
      </span>
      <div className="flex-1 h-2 overflow-hidden rounded-full bg-[#F0F0F0]">
        <div className="h-full rounded-full bg-black/80 transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-[12px] font-bold text-black">
        {formatTokens(value)} {suffix}
      </span>
    </div>
  );
};

/** 统计卡片（合计/输入/输出/推理）。 */
const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex-1 min-w-0 rounded-xl border border-[#EAEAEA] bg-white px-4 py-3">
    <p className="text-[11px] font-medium text-[#888888] mb-1">{label}</p>
    <p className="text-[18px] font-bold tracking-tight text-black">{value}</p>
  </div>
);

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

  return (
    <div className="max-w-5xl mx-auto w-full h-full flex flex-col pt-4">
      {/* 标题栏 + 日期控制 */}
      <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">Token 用量</h2>
          <p className="text-[13px] text-[#999999]">按天统计会话消耗，支持任意历史日期查询</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DatePicker value={startDate} max={endDate} onChange={date => setRange(date, endDate)} />
          <span className="text-[12px] text-[#BBBBBB]">—</span>
          <DatePicker value={endDate} min={startDate} onChange={date => setRange(startDate, date)} />
          <div className="w-px h-5 bg-[#EAEAEA]" />
          <button
            onClick={() => setRange(todayStr(), todayStr())}
            className="px-2.5 py-1.5 text-[12px] font-medium text-[#666666] hover:bg-[#F5F5F5] hover:text-black rounded-md transition-colors"
          >
            今天
          </button>
          <button
            onClick={() => setRange(daysAgoStr(6), todayStr())}
            className="px-2.5 py-1.5 text-[12px] font-medium text-[#666666] hover:bg-[#F5F5F5] hover:text-black rounded-md transition-colors"
          >
            近 7 天
          </button>
          <button
            onClick={() => setRange(daysAgoStr(29), todayStr())}
            className="px-2.5 py-1.5 text-[12px] font-medium text-[#666666] hover:bg-[#F5F5F5] hover:text-black rounded-md transition-colors"
          >
            近 30 天
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 shrink-0 rounded-lg border border-[#F3D1D1] bg-[#FFF5F5] px-4 py-2.5 text-[12px] text-[#B3261E]">
          {error}
        </div>
      )}

      {/* 内容区：页面不滚动，两个分布卡片内部滚动 */}
      <div className="flex-1 min-h-0 overflow-hidden -mr-4 pr-4 flex flex-col">
        {isLoading ? (
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-white border border-[#EAEAEA] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="flex-1 min-h-0 bg-white rounded-xl border border-[#EAEAEA] flex items-center justify-center">
            <p className="text-[13px] text-[#999999]">该时间段暂无 token 用量数据（同步完成后可见）</p>
          </div>
        ) : (
          <>
            {/* 统计卡片：推理卡片由"当天消耗金额"取代 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 shrink-0">
              <StatCard label="合计 Token" value={formatTokens(totals.totalTokens)} />
              <div
                className="flex-1 min-w-0 rounded-xl border border-[#EAEAEA] bg-white px-4 py-3"
                title="输入总量（含缓存命中部分）"
              >
                <p className="text-[11px] font-medium text-[#888888] mb-1">输入</p>
                <p className="text-[18px] font-bold tracking-tight text-black">{formatTokens(totals.inputTokens)}</p>
                <p className="mt-0.5 text-[10px] text-[#AAAAAA]">
                  缓存 {formatTokens(totals.cachedInputTokens)}（{cacheRate.toFixed(1)}%）
                </p>
              </div>
              <StatCard label="输出" value={formatTokens(totals.outputTokens)} />
              <div
                className="flex-1 min-w-0 rounded-xl border border-[#EAEAEA] bg-white px-4 py-3"
                title="按 OpenAI API 标准价估算（非缓存输入×单价 + 缓存输入×缓存价 + 输出×单价）"
              >
                <p className="text-[11px] font-medium text-[#888888] mb-1">金额</p>
                <p className="text-[18px] font-bold tracking-tight text-black">{formatCost(totalCost)}</p>
                <p className="mt-0.5 text-[10px] text-[#AAAAAA]">按 API 标准价估算</p>
              </div>
            </div>

            {/* 两个分布卡片平分剩余高度，各自内部滚动 */}
            <div className="grid grid-cols-1 gap-4 flex-1 min-h-0">
              <div className="bg-white rounded-xl border border-[#EAEAEA] px-5 py-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[14px] font-semibold text-black">按项目分布</h3>
                  <span className="text-[11px] text-[#999999]">{mergedProjects.length} 个项目</span>
                </div>
                {mergedProjects.length === 0 ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center">
                    <p className="text-[12px] text-[#AAAAAA]">暂无项目数据</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
                    {mergedProjects.map(project => (
                      <DistributionBar
                        key={project.projectPath}
                        label={project.name}
                        value={project.totalTokens}
                        max={maxProjectTokens}
                        suffix=""
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-[#EAEAEA] px-5 py-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[14px] font-semibold text-black">按模型分布</h3>
                  <span className="text-[11px] text-[#999999]">{mergedModels.length} 个模型</span>
                </div>
                {mergedModels.length === 0 ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center">
                    <p className="text-[12px] text-[#AAAAAA]">暂无模型数据</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
                    {mergedModels.map(model => (
                      <DistributionBar
                        key={model.model}
                        label={model.model}
                        value={model.totalTokens}
                        max={maxModelTokens}
                        suffix=""
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
