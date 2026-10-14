import React, { useMemo, useState } from 'react';
import { DailyTokenUsage } from '../types/session';
import { formatTokens } from '../utils/format';
import { calcModelCost, formatCost } from '../utils/modelPricing';
import { cn } from '../lib/utils';

export type Granularity = 'day' | 'week' | 'month';

export interface TrendBucket {
  key: string;
  label: string;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cost: number;
}

/** 分类色板（dataviz 参考色板前 5 槽，已通过相邻对色盲校验）；其余归入中性灰「其他」。 */
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const OTHER_COLOR = '#a3a3a3';
const TOTAL_COLOR = 'color-mix(in oklab, var(--primary) 72%, transparent)';
const OTHER_KEY = '__other__';

export const GRANULARITY_LABEL: Record<Granularity, string> = { day: '按天', week: '按周', month: '按月' };

function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); // 周一为一周开始
  return result;
}

function bucketKey(date: Date, granularity: Granularity): string {
  if (granularity === 'month') return toDateStr(date).slice(0, 7);
  if (granularity === 'week') return toDateStr(startOfWeek(date));
  return toDateStr(date);
}

function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return `${y}年${Number(m)}月`;
  }
  const date = parseDate(key);
  const md = `${date.getMonth() + 1}/${date.getDate()}`;
  return granularity === 'week' ? `${md} 当周` : md;
}

/** 坐标轴上限取 1/2/5 × 10^n 的整数，刻度更干净。 */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

function dayCost(day: DailyTokenUsage): number {
  let cost = 0;
  for (const model of day.models) {
    const modelCost = calcModelCost(model.model, {
      input: model.inputTokens,
      cachedInput: model.cachedInputTokens,
      output: model.outputTokens,
      reasoning: model.reasoningTokens,
    });
    if (modelCost !== null) cost += modelCost;
  }
  return cost;
}

export function buildTrendBuckets(days: DailyTokenUsage[], startDate: string | null, endDate: string | null) {
  const first = startDate ?? days[0]?.date;
  const last = endDate ?? days[days.length - 1]?.date;
  if (!first || !last) return { buckets: [] as TrendBucket[], granularity: 'day' as Granularity };

  const start = parseDate(first);
  const end = parseDate(last);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const granularity: Granularity = spanDays <= 62 ? 'day' : spanDays <= 366 ? 'week' : 'month';

  // 先按范围补齐空桶，没有会话的日期也显示为 0，趋势才不会失真。
  const map = new Map<string, TrendBucket>();
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = bucketKey(cursor, granularity);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: bucketLabel(key, granularity),
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        cost: 0,
      });
    }
  }
  for (const day of days) {
    const bucket = map.get(bucketKey(parseDate(day.date), granularity));
    if (!bucket) continue;
    bucket.totalTokens += day.totalTokens;
    bucket.inputTokens += day.inputTokens;
    bucket.cachedInputTokens += day.cachedInputTokens;
    bucket.outputTokens += day.outputTokens;
    bucket.cost += dayCost(day);
  }
  return { buckets: Array.from(map.values()), granularity };
}

export interface TrendSeries {
  key: string;
  label: string;
  total: number;
  color: string;
}

/** 把项目 / 模型按时间桶拆分：取总量前 5，其余合并为「其他」。 */
export function buildSeriesTrend(
  days: DailyTokenUsage[],
  buckets: TrendBucket[],
  granularity: Granularity,
  dimension: 'project' | 'model',
): { series: TrendSeries[]; values: number[][] } {
  const entriesOf = (day: DailyTokenUsage) =>
    dimension === 'project'
      ? day.projects.map(item => ({ key: item.projectPath, label: item.name, value: item.totalTokens }))
      : day.models.map(item => ({ key: item.model, label: item.model, value: item.totalTokens }));

  const totals = new Map<string, { label: string; total: number }>();
  for (const day of days) {
    for (const entry of entriesOf(day)) {
      const current = totals.get(entry.key);
      if (current) current.total += entry.value;
      else totals.set(entry.key, { label: entry.label, total: entry.value });
    }
  }
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1].total - a[1].total);
  const top = ranked.slice(0, SERIES_COLORS.length);
  const otherTotal = ranked.slice(SERIES_COLORS.length).reduce((sum, [, item]) => sum + item.total, 0);

  const series: TrendSeries[] = top.map(([key, item], index) => ({
    key,
    label: item.label,
    total: item.total,
    color: SERIES_COLORS[index],
  }));
  if (otherTotal > 0) series.push({ key: OTHER_KEY, label: '其他', total: otherTotal, color: OTHER_COLOR });

  const seriesIndex = new Map(series.map((item, index) => [item.key, index]));
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));
  const values = buckets.map(() => series.map(() => 0));
  for (const day of days) {
    const row = bucketIndex.get(bucketKey(parseDate(day.date), granularity));
    if (row === undefined) continue;
    for (const entry of entriesOf(day)) {
      const column = seriesIndex.get(entry.key) ?? seriesIndex.get(OTHER_KEY);
      if (column !== undefined) values[row][column] += entry.value;
    }
  }
  return { series, values };
}

interface StackedColumnChartProps {
  buckets: TrendBucket[];
  /** values[桶][序列]，自下而上堆叠 */
  values: number[][];
  colors: string[];
  ariaLabel: string;
  renderTooltip: (index: number) => React.ReactNode;
}

/** 柱状趋势图（单序列或堆叠），高度随容器伸缩。 */
const StackedColumnChart: React.FC<StackedColumnChartProps> = ({ buckets, values, colors, ariaLabel, renderTooltip }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const columnTotals = values.map(row => row.reduce((sum, value) => sum + value, 0));
  const axisMax = niceCeil(Math.max(0, ...columnTotals));
  // x 轴只标首、中、尾三个刻度，避免标签拥挤。
  const tickIndexes = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]);
  // 提示框放在悬停柱的侧边（前半段在右、后半段在左），不遮挡该柱。
  const tooltipOnRight = hoverIndex !== null && hoverIndex < buckets.length / 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[120px] flex-1 gap-2">
        {/* y 轴刻度 */}
        <div className="flex w-9 shrink-0 flex-col justify-between text-right text-caption leading-none text-muted-foreground tabular-nums">
          <span>{formatTokens(axisMax)}</span>
          <span>{formatTokens(axisMax / 2)}</span>
          <span>0</span>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* 网格线：发丝线，退后于数据 */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            <div className="h-px bg-border" />
            <div className="h-px bg-border" />
            <div className="h-px bg-border" />
          </div>

          <div
            role="img"
            aria-label={ariaLabel}
            className="relative flex h-full items-end gap-0.5"
            onMouseLeave={() => setHoverIndex(null)}
          >
            {buckets.map((bucket, index) => {
              const total = columnTotals[index];
              let drawn = 0;
              return (
                <div
                  key={bucket.key}
                  className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
                  onMouseEnter={() => setHoverIndex(index)}
                >
                  <div
                    className={cn(
                      'flex w-full max-w-6 flex-col-reverse overflow-hidden rounded-t-[4px] transition-opacity',
                      hoverIndex !== null && hoverIndex !== index && 'opacity-45',
                    )}
                    style={{ height: total > 0 ? `max(2px, ${(total / axisMax) * 100}%)` : 0 }}
                  >
                    {values[index].map((value, seriesIdx) => {
                      if (value <= 0) return null;
                      // 堆叠段之间留 2px 卡片底色的间隙，而不是描边。
                      const gap = drawn++ > 0;
                      return (
                        <div
                          key={seriesIdx}
                          className={cn('w-full shrink-0', gap && 'border-b-2 border-card')}
                          style={{ height: `${(value / total) * 100}%`, backgroundColor: colors[seriesIdx] }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {hoverIndex !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-56 rounded-lg border bg-popover px-3 py-2 text-label shadow-md"
              style={
                tooltipOnRight
                  ? { left: `calc(${((hoverIndex + 1) / buckets.length) * 100}% + 6px)` }
                  : { right: `calc(${((buckets.length - hoverIndex) / buckets.length) * 100}% + 6px)` }
              }
            >
              {renderTooltip(hoverIndex)}
            </div>
          )}
        </div>
      </div>

      {/* x 轴：首 / 中 / 尾 */}
      <div className="mt-1.5 ml-11 flex h-3.5 shrink-0 gap-0.5 text-caption text-muted-foreground tabular-nums" aria-hidden="true">
        {buckets.map((bucket, index) => (
          <div key={bucket.key} className="relative min-w-0 flex-1">
            {tickIndexes.has(index) && (
              <span
                className={cn(
                  'absolute top-0 whitespace-nowrap',
                  index === 0 ? 'left-0' : index === buckets.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                )}
              >
                {bucket.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const TooltipRow = ({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) => (
  <div className="flex items-center justify-between gap-3">
    <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
      {color && <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />}
      <span className="truncate">{label}</span>
    </dt>
    <dd className={cn('shrink-0 tabular-nums', strong ? 'font-medium text-foreground' : 'text-foreground')}>{value}</dd>
  </div>
);

/** 总用量趋势：单序列柱状图。 */
export const TotalTrendChart: React.FC<{ buckets: TrendBucket[]; granularity: Granularity }> = ({ buckets, granularity }) => {
  const values = useMemo(() => buckets.map(bucket => [bucket.totalTokens]), [buckets]);
  const peak = Math.max(0, ...buckets.map(bucket => bucket.totalTokens));
  return (
    <>
      <StackedColumnChart
        buckets={buckets}
        values={values}
        colors={[TOTAL_COLOR]}
        ariaLabel={`${GRANULARITY_LABEL[granularity]}统计的 Token 用量，峰值 ${formatTokens(peak)}`}
        renderTooltip={index => {
          const bucket = buckets[index];
          return (
            <>
              <p className="mb-1 font-medium text-foreground">{bucket.label}</p>
              <dl className="space-y-0.5">
                <TooltipRow label="合计" value={formatTokens(bucket.totalTokens)} strong />
                <TooltipRow label="输入 / 缓存" value={`${formatTokens(bucket.inputTokens)} / ${formatTokens(bucket.cachedInputTokens)}`} />
                <TooltipRow label="输出" value={formatTokens(bucket.outputTokens)} />
                <TooltipRow label="预估费用" value={formatCost(bucket.cost)} />
              </dl>
            </>
          );
        }}
      />
      <table className="sr-only">
        <caption>Token 用量趋势明细</caption>
        <thead>
          <tr><th scope="col">时间</th><th scope="col">合计 Token</th><th scope="col">预估费用</th></tr>
        </thead>
        <tbody>
          {buckets.map(bucket => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              <td>{formatTokens(bucket.totalTokens)}</td>
              <td>{formatCost(bucket.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

/** 按项目 / 模型堆叠的趋势：图例（含总量与占比）+ 堆叠柱状图。 */
export const SeriesTrendChart: React.FC<{
  buckets: TrendBucket[];
  series: TrendSeries[];
  values: number[][];
  grandTotal: number;
  ariaLabel: string;
}> = ({ buckets, series, values, grandTotal, ariaLabel }) => {
  const colors = series.map(item => item.color);
  const share = (value: number) => (grandTotal > 0 ? `${((value / grandTotal) * 100).toFixed(1)}%` : '0%');

  return (
    <>
      <ul className="mb-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1.5" aria-label="图例">
        {series.map(item => (
          <li key={item.key} className="flex min-w-0 items-center gap-1.5 text-label" title={`${item.label}: ${formatTokens(item.total)}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span className="max-w-[180px] truncate text-foreground">{item.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatTokens(item.total)} · {share(item.total)}
            </span>
          </li>
        ))}
      </ul>
      <StackedColumnChart
        buckets={buckets}
        values={values}
        colors={colors}
        ariaLabel={ariaLabel}
        renderTooltip={index => {
          const row = values[index];
          const total = row.reduce((sum, value) => sum + value, 0);
          return (
            <>
              <p className="mb-1 font-medium text-foreground">{buckets[index].label}</p>
              <dl className="space-y-0.5">
                <TooltipRow label="合计" value={formatTokens(total)} strong />
                {/* 与堆叠顺序一致：自上而下 */}
                {series
                  .map((item, seriesIdx) => ({ item, value: row[seriesIdx] }))
                  .filter(({ value }) => value > 0)
                  .reverse()
                  .map(({ item, value }) => (
                    <TooltipRow key={item.key} label={item.label} value={formatTokens(value)} color={item.color} />
                  ))}
              </dl>
            </>
          );
        }}
      />
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">时间</th>
            {series.map(item => <th key={item.key} scope="col">{item.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket, index) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              {values[index].map((value, seriesIdx) => <td key={seriesIdx}>{formatTokens(value)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};
