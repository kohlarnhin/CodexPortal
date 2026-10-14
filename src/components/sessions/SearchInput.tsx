import React, { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

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
    <Search aria-hidden="true" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
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
      className="h-8 w-full min-w-0 pl-9 pr-9 text-body bg-background border border-input rounded-md shadow-xs placeholder:text-muted-foreground outline-none transition-[color,box-shadow] focus:border-foreground/60 disabled:opacity-50 [&::-webkit-search-cancel-button]:appearance-none"
    />
    {value && (
      <button
        type="button"
        aria-label={`清除${label}`}
        title="清除搜索"
        onClick={() => onChange('')}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-ring"
      >
        <X aria-hidden="true" size={12} />
      </button>
    )}
  </div>
));

SearchInput.displayName = 'SearchInput';
export default SearchInput;
