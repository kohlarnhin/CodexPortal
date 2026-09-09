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
      className={`relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-2 ${
        isSm ? 'w-8 h-4.5' : 'w-10 h-5'
      } ${
        disabled ? 'opacity-40 cursor-not-allowed' : ''
      } ${checked ? 'bg-black' : 'bg-[#DCDCDC] hover:bg-[#D0D0D0]'}`}
    >
      <span
        className={`bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
          isSm
            ? `w-3.5 h-3.5 ${checked ? 'translate-x-[15px]' : 'translate-x-[2px]'}`
            : `w-4 h-4 ${checked ? 'translate-x-5' : 'translate-x-[2px]'}`
        }`}
      />
    </button>
  );
};

export default ToggleSwitch;
