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
    <Search aria-hidden="true" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--label)]" />
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
      className="bento-field h-8 w-full min-w-0 rounded-[10px] pl-8 pr-8 text-body placeholder:text-[var(--label)] disabled:opacity-50 [&::-webkit-search-cancel-button]:appearance-none"
    />
    {value && (
      <button
        type="button"
        aria-label={`清除${label}`}
        title="清除搜索"
        onClick={() => onChange('')}
        className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[var(--label)] transition-colors hover:bg-[var(--hover)] hover:text-foreground"
      >
        <X aria-hidden="true" size={12} />
      </button>
    )}
  </div>
));

SearchInput.displayName = 'SearchInput';
export default SearchInput;
