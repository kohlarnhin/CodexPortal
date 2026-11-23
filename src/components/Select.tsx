import { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import { Check, ChevronDown } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
}

export default function Select({ value, onChange, options, className, disabled, align = 'left' }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        className={cn(
          'bento-field flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 px-3 text-left text-body select-none disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-foreground leading-normal">{selectedOption?.label || value}</span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={cn('shrink-0 text-muted-foreground transition-transform duration-150', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && !disabled && (
        <div
          role="listbox"
          className={cn(
            'bento-popup animate-fade-in absolute z-50 mt-1.5 min-w-full w-max max-w-[320px] max-h-64 overflow-y-auto p-1.5',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {options.map((option) => {
            const selected = value === option.value;
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className="bento-choice-row justify-between"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected && <Check size={13} aria-hidden="true" className="shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
