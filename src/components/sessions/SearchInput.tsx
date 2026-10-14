import React, { forwardRef } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({
  value, onChange, label, placeholder, disabled, onKeyDown,
}, ref) => (
  <div className="relative min-w-0 flex-1">
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input
      ref={ref}
      type="search"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      autoComplete="off"
      spellCheck={false}
      className="h-8 w-full min-w-0 pl-9 pr-9 text-[13px] bg-background border border-input rounded-md shadow-xs placeholder:text-muted-foreground outline-none transition-[color,box-shadow] focus:border-neutral-700 disabled:opacity-50 [&::-webkit-search-cancel-button]:appearance-none"
    />
    {value && (
      <button
        type="button"
        aria-label={`清除${label}`}
        title="清除搜索"
        onClick={() => onChange('')}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-ring"
      >
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m18 6-12 12M6 6l12 12"/></svg>
      </button>
    )}
  </div>
));

SearchInput.displayName = 'SearchInput';
export default SearchInput;
