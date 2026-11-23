import React from 'react';
import { cn } from '../lib/utils';

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
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      className={cn(
        'bento-switch inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-45',
        isSm ? 'h-[18px] w-[32px]' : 'h-[22px] w-[38px]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block rounded-full transition-transform duration-150',
          isSm
            ? cn('size-[14px]', checked ? 'translate-x-[14px]' : 'translate-x-0')
            : cn('size-[18px]', checked ? 'translate-x-[16px]' : 'translate-x-0'),
        )}
      />
    </button>
  );
};

export default ToggleSwitch;
