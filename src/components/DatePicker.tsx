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
    <div className={cn('relative inline-flex items-center', className)}>
      <div
        data-open={activePicker ? 'true' : undefined}
        className="bento-field inline-flex h-8 items-center rounded-full px-3"
      >
        <Calendar size={12.5} className="mr-1.5 shrink-0 text-[var(--label)]" />

        <button
          type="button"
          onClick={() => openPicker('start')}
          className={cn(
            'inline-grid cursor-pointer rounded-full px-1.5 py-0.5 text-center text-[12px] tabular-nums transition-colors select-none',
            activePicker === 'start'
              ? 'bg-[var(--button-fill)] font-semibold text-foreground'
              : 'text-foreground hover:bg-[var(--hover)]',
          )}
          title="选择起始日期"
        >
          <DateSlot>{allDates ? '不限起始' : startDate}</DateSlot>
        </button>

        <span className="px-1 text-caption font-medium text-[var(--label)] select-none">—</span>

        <button
          type="button"
          onClick={() => openPicker('end')}
          className={cn(
            'inline-grid cursor-pointer rounded-full px-1.5 py-0.5 text-center text-[12px] tabular-nums transition-colors select-none',
            activePicker === 'end'
              ? 'bg-[var(--button-fill)] font-semibold text-foreground'
              : 'text-foreground hover:bg-[var(--hover)]',
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
              'bento-popup animate-fade-in absolute top-full z-[95] mt-1.5 w-[248px] p-3 select-none',
              activePicker === 'end' ? 'right-0' : 'left-0',
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <button
                type="button"
                onClick={goPrevMonth}
                className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
              >
                <ChevronLeft size={14} strokeWidth={2.5} />
              </button>
              <span className="text-body font-semibold text-foreground">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
              >
                <ChevronRight size={14} strokeWidth={2.5} />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map(day => (
                <span key={day} className="py-0.5 text-center text-caption text-[var(--label)]">
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
                      'h-7 cursor-pointer rounded-full text-label tabular-nums transition-colors select-none',
                      isSelected
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : disabled
                          ? 'cursor-not-allowed text-[var(--label)]/35'
                          : inRange
                            ? 'bg-[var(--button-fill)] text-foreground'
                            : 'text-foreground hover:bg-[var(--hover)]',
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
    <div className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        onClick={open}
        className="bento-field flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-body tabular-nums transition-colors hover:bg-[var(--hover)]"
      >
        <Calendar size={12.5} className="text-[var(--label)]" />
        {value}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setIsOpen(false)} />
          <div
            className={cn(
              'bento-popup animate-fade-in absolute top-full z-[95] mt-1.5 w-[248px] p-3 select-none',
              align === 'end' ? 'right-0' : 'left-0',
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <button
                type="button"
                onClick={goPrevMonth}
                className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
              >
                <ChevronLeft size={14} strokeWidth={2.5} />
              </button>
              <span className="text-body font-semibold text-foreground">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
              >
                <ChevronRight size={14} strokeWidth={2.5} />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map(day => (
                <span key={day} className="py-0.5 text-center text-caption text-[var(--label)]">
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
                      'h-7 cursor-pointer rounded-full text-label tabular-nums transition-colors select-none',
                      dateStr === value
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : isDisabled(dateStr)
                          ? 'cursor-not-allowed text-[var(--label)]/35'
                          : 'text-foreground hover:bg-[var(--hover)]',
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
