import React, { useMemo, useState } from 'react';
import { cn } from '../lib/utils';

export interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  allDates?: boolean;
  onChange: (start: string, end: string) => void;
  className?: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function toDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseValue(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

/** 统一单边框日期范围选择器：拒绝嵌套边框，单一体化卡片 */
export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  allDates = false,
  onChange,
  className,
}) => {
  const [activePicker, setActivePicker] = useState<'start' | 'end' | null>(null);
  const [viewYear, setViewYear] = useState(() => parseValue(startDate).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parseValue(startDate).getMonth());

  const openPicker = (type: 'start' | 'end') => {
    if (activePicker === type) {
      setActivePicker(null);
      return;
    }
    const val = type === 'start' ? startDate : endDate;
    const current = parseValue(val);
    setViewYear(current.getFullYear());
    setViewMonth(current.getMonth());
    setActivePicker(type);
  };

  const cells = useMemo(() => {
    const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const result: Array<string | null> = [];
    for (let i = 0; i < firstWeekday; i++) result.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      result.push(toDateStr(new Date(viewYear, viewMonth, day)));
    }
    return result;
  }, [viewYear, viewMonth]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(year => year - 1);
      setViewMonth(11);
    } else {
      setViewMonth(month => month - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(year => year + 1);
      setViewMonth(0);
    } else {
      setViewMonth(month => month + 1);
    }
  };

  const isDisabled = (dateStr: string) => {
    if (allDates) return false;
    if (activePicker === 'start') return dateStr > endDate;
    if (activePicker === 'end') return dateStr < startDate;
    return false;
  };

  const currentValue = activePicker === 'start' ? startDate : endDate;

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      {/* 单一一体化容器：无嵌套边框，单边框轻量卡片 */}
      <div
        className={cn(
          "inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 shadow-xs transition-[color,box-shadow]",
          activePicker && "border-neutral-700"
        )}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground mr-1.5 shrink-0"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>

        <button
          type="button"
          onClick={() => openPicker('start')}
          className={cn(
            "text-[12.5px] tabular-nums rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer select-none",
            activePicker === 'start'
              ? "bg-accent text-foreground font-medium"
              : "text-foreground hover:bg-accent"
          )}
          title="选择起始日期"
        >
          {allDates ? '不限起始' : startDate}
        </button>

        <span className="text-neutral-300 text-[11px] select-none font-medium px-1">—</span>

        <button
          type="button"
          onClick={() => openPicker('end')}
          className={cn(
            "text-[12.5px] tabular-nums rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer select-none",
            activePicker === 'end'
              ? "bg-accent text-foreground font-medium"
              : "text-foreground hover:bg-accent"
          )}
          title="选择结束日期"
        >
          {allDates ? '不限结束' : endDate}
        </button>
      </div>

      {activePicker && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setActivePicker(null)} />
          <div
            className={cn(
              "absolute z-[95] top-full mt-1.5 bg-popover text-popover-foreground rounded-md border shadow-md p-3 w-[248px] animate-fade-in select-none",
              activePicker === 'end' ? "right-0" : "left-0"
            )}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <button
                type="button"
                onClick={goPrevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <span className="text-[13px] font-semibold text-foreground">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map(day => (
                <span key={day} className="text-center text-[11px] text-muted-foreground py-0.5">
                  {day}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((dateStr, index) => {
                if (dateStr === null) {
                  return <span key={`empty-${index}`} className="h-7" />;
                }
                const isSelected = !allDates && dateStr === currentValue;
                const disabled = isDisabled(dateStr);
                const inRange = !allDates && dateStr >= startDate && dateStr <= endDate;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (allDates) {
                        onChange(dateStr, dateStr);
                      } else if (activePicker === 'start') {
                        onChange(dateStr, endDate);
                      } else {
                        onChange(startDate, dateStr);
                      }
                      setActivePicker(null);
                    }}
                    className={cn(
                      "h-7 text-[11.5px] rounded-md transition-colors cursor-pointer select-none",
                      isSelected
                        ? "bg-primary text-primary-foreground font-medium"
                        : disabled
                          ? "text-muted-foreground/40 cursor-not-allowed"
                          : inRange
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground hover:bg-accent"
                    )}
                  >
                    {Number(dateStr.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export interface DatePickerProps {
  value: string;
  min?: string;
  max?: string;
  align?: 'start' | 'end';
  onChange: (value: string) => void;
  className?: string;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  min,
  max,
  align = 'start',
  onChange,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parseValue(value).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parseValue(value).getMonth());

  const open = () => {
    const current = parseValue(value);
    setViewYear(current.getFullYear());
    setViewMonth(current.getMonth());
    setIsOpen(true);
  };

  const cells = useMemo(() => {
    const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const result: Array<string | null> = [];
    for (let i = 0; i < firstWeekday; i++) result.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      result.push(toDateStr(new Date(viewYear, viewMonth, day)));
    }
    return result;
  }, [viewYear, viewMonth]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(year => year - 1);
      setViewMonth(11);
    } else {
      setViewMonth(month => month - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(year => year + 1);
      setViewMonth(0);
    } else {
      setViewMonth(month => month + 1);
    }
  };

  const isDisabled = (dateStr: string) =>
    (min !== undefined && dateStr < min) || (max !== undefined && dateStr > max);

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        onClick={open}
        className="flex h-8 items-center gap-1.5 px-2.5 text-[12.5px] tabular-nums bg-background border border-input rounded-md hover:bg-accent transition-colors shadow-xs cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        {value}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setIsOpen(false)} />
          <div className={cn("absolute z-[95] top-full mt-1.5 bg-popover text-popover-foreground rounded-md border shadow-md p-3 w-[248px] animate-fade-in select-none", align === 'end' ? 'right-0' : 'left-0')}>
            <div className="flex items-center justify-between mb-2 px-1">
              <button
                type="button"
                onClick={goPrevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <span className="text-[13px] font-semibold text-foreground">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map(day => (
                <span key={day} className="text-center text-[11px] text-muted-foreground py-0.5">
                  {day}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((dateStr, index) =>
                dateStr === null ? (
                  <span key={`empty-${index}`} className="h-7" />
                ) : (
                  <button
                    key={dateStr}
                    type="button"
                    disabled={isDisabled(dateStr)}
                    onClick={() => {
                      onChange(dateStr);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "h-7 text-[11.5px] rounded-md transition-colors cursor-pointer select-none",
                      dateStr === value
                        ? 'bg-primary text-primary-foreground font-medium'
                        : isDisabled(dateStr)
                          ? 'text-muted-foreground/40 cursor-not-allowed'
                          : 'text-foreground hover:bg-accent'
                    )}
                  >
                    {Number(dateStr.slice(8))}
                  </button>
                ),
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DatePicker;
