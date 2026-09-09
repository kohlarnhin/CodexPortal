import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';

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
          "w-full px-3 py-1.5 pr-7 bg-white border rounded-lg text-[13px] font-medium cursor-pointer flex items-center justify-between transition-all shadow-2xs select-none",
          isOpen ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200/90 hover:border-neutral-300",
          disabled && "opacity-50 pointer-events-none cursor-not-allowed bg-neutral-100"
        )}
      >
        <span className="truncate text-neutral-900 leading-normal">{selectedOption?.label || value}</span>
        <div className="absolute inset-y-0 right-0 flex items-center px-2 text-neutral-400 pointer-events-none">
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
            className={cn("transition-transform duration-200", isOpen && "rotate-180")}
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
      </div>

      {isOpen && !disabled && (
        <div 
          className={cn(
            "absolute z-50 min-w-full w-max max-w-[320px] mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg overflow-y-auto max-h-60 py-1 animate-in fade-in zoom-in-95 duration-100",
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
                "px-3 py-1.5 text-[12.5px] cursor-pointer flex items-center gap-2 transition-colors select-none",
                value === option.value 
                  ? "bg-neutral-100 text-neutral-900 font-semibold" 
                  : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              )}
            >
              <div className="w-3 flex justify-center shrink-0">
                {value === option.value && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-900"><polyline points="20 6 9 17 4 12"/></svg>
                )}
              </div>
              <span className="truncate">{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

