import React, { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

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
/** 日期文本占位：按 "0000-00-00" 预留宽度，切换「全部」等较短文案时容器不缩放，避免周围控件抖动。 */
const DateSlot = ({ children }: { children: React.ReactNode }) => (
  <>
    <span aria-hidden="true" className="invisible col-start-1 row-start-1">0000-00-00</span>
    <span className="col-start-1 row-start-1">{children}</span>
  </>
);

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
          activePicker && "border-foreground/60"
        )}
      >
        <Calendar size={13} className="text-muted-foreground mr-1.5 shrink-0" />

        <button
          type="button"
          onClick={() => openPicker('start')}
          className={cn(
            "inline-grid text-body tabular-nums text-center rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer select-none",
            activePicker === 'start'
              ? "bg-accent text-foreground font-medium"
              : "text-foreground hover:bg-accent"
          )}
          title="选择起始日期"
        >
          <DateSlot>{allDates ? '不限起始' : startDate}</DateSlot>
        </button>

        <span className="text-muted-foreground/50 text-caption select-none font-medium px-1">—</span>

        <button
          type="button"
          onClick={() => openPicker('end')}
          className={cn(
            "inline-grid text-body tabular-nums text-center rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer select-none",
            activePicker === 'end'
              ? "bg-accent text-foreground font-medium"
              : "text-foreground hover:bg-accent"
          )}
          title="选择结束日期"
        >
          <DateSlot>{allDates ? '不限结束' : endDate}</DateSlot>
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
                <ChevronLeft size={14} strokeWidth={2.5} />
              </button>
              <span className="text-body font-semibold text-foreground">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <ChevronRight size={14} strokeWidth={2.5} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map(day => (
                <span key={day} className="text-center text-caption text-muted-foreground py-0.5">
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
                      "h-7 text-label rounded-md transition-colors cursor-pointer select-none",
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
        className="flex h-8 items-center gap-1.5 px-2.5 text-body tabular-nums bg-background border border-input rounded-md hover:bg-accent transition-colors shadow-xs cursor-pointer"
      >
        <Calendar size={13} className="text-muted-foreground" />
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
                <ChevronLeft size={14} strokeWidth={2.5} />
              </button>
              <span className="text-body font-semibold text-foreground">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <ChevronRight size={14} strokeWidth={2.5} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map(day => (
                <span key={day} className="text-center text-caption text-muted-foreground py-0.5">
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
                      "h-7 text-label rounded-md transition-colors cursor-pointer select-none",
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
