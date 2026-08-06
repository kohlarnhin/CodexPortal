import React, { useState, useRef, useEffect } from 'react';

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}

export default function Select({ value, onChange, options }: SelectProps) {
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
    <div className="relative" ref={containerRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 pr-8 bg-[#FAFAFA] border ${isOpen ? 'border-black ring-1 ring-black' : 'border-[#EAEAEA]'} rounded-md text-[14px] cursor-pointer flex items-center justify-between transition-all`}
      >
        <span className="truncate select-none">{selectedOption?.label || value}</span>
        <div className="absolute inset-y-0 right-0 flex items-center px-2.5 text-[#888888] pointer-events-none">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-[#EAEAEA] rounded-md shadow-lg overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-150">
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`px-3 py-1.5 text-[13px] cursor-pointer flex items-center gap-2 transition-colors select-none ${
                value === option.value 
                  ? 'bg-[#F0F0F0] text-black font-medium' 
                  : 'text-[#444444] hover:bg-[#F9F9F9] hover:text-black'
              }`}
            >
              <div className="w-3 flex justify-center shrink-0">
                {value === option.value && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
