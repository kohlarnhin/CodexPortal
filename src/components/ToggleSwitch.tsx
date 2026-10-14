import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
  size?: 'sm' | 'md';
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  disabled = false,
  label,
  onToggle,
  size = 'md',
}) => {
  const isSm = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      className={`peer relative inline-flex items-center rounded-full border border-transparent shadow-xs transition-colors outline-none cursor-pointer shrink-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
        isSm ? 'h-4 w-7' : 'h-[1.15rem] w-8'
      } ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${checked ? 'bg-primary' : 'bg-input'}`}
    >
      <span
        className={`pointer-events-none block rounded-full bg-background ring-0 transition-transform ${
          isSm
            ? `h-3 w-3 ${checked ? 'translate-x-[calc(100%+1px)]' : 'translate-x-px'}`
            : `h-4 w-4 ${checked ? 'translate-x-[calc(100%-2px)]' : 'translate-x-0'}`
        }`}
      />
    </button>
  );
};

export default ToggleSwitch;
