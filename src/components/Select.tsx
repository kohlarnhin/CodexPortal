import React, { useState, useRef, useEffect } from 'react';
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
    <div className={cn("relative", className)} ref={containerRef}>
      <div 
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        className={cn(
          "w-full h-9 px-3 pr-8 bg-background border border-input rounded-md text-body cursor-pointer flex items-center justify-between transition-[color,box-shadow] shadow-xs select-none",
          isOpen && "border-foreground/60",
          disabled && "opacity-50 pointer-events-none cursor-not-allowed"
        )}
      >
        <span className="truncate text-foreground leading-normal">{selectedOption?.label || value}</span>
        <div className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground pointer-events-none">
          <ChevronDown size={13} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
        </div>
      </div>

      {isOpen && !disabled && (
        <div 
          className={cn(
            "absolute z-50 min-w-full w-max max-w-[320px] mt-1 bg-popover text-popover-foreground border rounded-md shadow-md overflow-y-auto max-h-60 p-1 animate-fade-in",
            align === 'right' ? "right-0" : "left-0"
          )}
        >
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={cn(
                "px-2 py-1.5 rounded-sm text-body cursor-pointer flex items-center justify-between gap-2 select-none text-foreground hover:bg-accent hover:text-accent-foreground",
                value === option.value && "font-medium"
              )}
            >
              <span className="truncate">{option.label}</span>
              <div className="w-3.5 flex justify-center shrink-0">
                {value === option.value && (
                  <Check size={14} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

