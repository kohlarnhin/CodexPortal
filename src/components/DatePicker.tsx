import React, { useMemo, useState } from 'react';

interface DatePickerProps {
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function toDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseValue(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

/** 极简日期选择器：按钮展示当前值，点击弹出月历（周一开头）。 */
const DatePicker: React.FC<DatePickerProps> = ({ value, min, max, onChange }) => {
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
    <div className="relative">
      <button
        onClick={open}
        className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-mono bg-white border border-[#EAEAEA] rounded-lg hover:border-[#BBBBBB] focus:border-black transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888888]"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        {value}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setIsOpen(false)} />
          <div className="absolute z-[95] mt-1.5 bg-white rounded-xl border border-[#EAEAEA] shadow-xl p-3 w-[248px] animate-modal-in">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <button
                onClick={goPrevMonth}
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <span className="text-[13px] font-semibold text-black">
                {viewYear}年{viewMonth + 1}月
              </span>
              <button
                onClick={goNextMonth}
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-0.5">
              {WEEKDAYS.map(day => (
                <span key={day} className="text-center text-[10px] font-medium text-[#AAAAAA] py-1">
                  {day}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((dateStr, index) =>
                dateStr === null ? (
                  <span key={`empty-${index}`} className="h-8" />
                ) : (
                  <button
                    key={dateStr}
                    disabled={isDisabled(dateStr)}
                    onClick={() => {
                      onChange(dateStr);
                      setIsOpen(false);
                    }}
                    className={`h-8 text-[12px] rounded-md transition-colors ${
                      dateStr === value
                        ? 'bg-black text-white font-semibold'
                        : isDisabled(dateStr)
                          ? 'text-[#DDDDDD] cursor-not-allowed'
                          : 'text-[#444444] hover:bg-[#F5F5F5]'
                    }`}
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
