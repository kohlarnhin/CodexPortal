import React, { useId } from 'react';

interface LogoProps {
  className?: string;
  animated?: boolean;
}

/**
 * SleekPortalLogo:
 * 科技感十足的动态 Portal Logo。
 * 内部金属质感的 C 字上，电光蓝小圆点（Dot）与外圈微光长条（Strip）
 * 沿着 C 字轨道做优雅平滑的相对往复滑动（Relative Sliding）。
 */
export const SleekPortalLogo: React.FC<LogoProps> = ({ className = "w-7 h-7", animated = true }) => {
  const rawId = useId();
  const id = rawId.replace(/:/g, '_');

  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Dark rounded background */}
      <rect width="100" height="100" rx="24" fill="#000000" />
      
      {/* Outer Portal Ring (Subtle base track) */}
      <path 
        d="M77 23 A 38 38 0 1 0 77 77" 
        stroke="#1E1E24" 
        strokeWidth="3" 
        strokeLinecap="round" 
      />
      
      {/* Outer Portal Ring (Dynamic glowing accent strip sliding along C) */}
      <g
        className={animated ? "portal-logo-strip" : ""}
        style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}
      >
        <path 
          d="M77 23 A 38 38 0 0 0 40.2 13.3" 
          stroke={`url(#${id}-ring-grad)`} 
          strokeWidth="3.5" 
          strokeLinecap="round"
          filter={`url(#${id}-strip-glow)`}
        />
      </g>
      
      {/* Inner 'C' - Metallic / Silver gradient */}
      <path 
        d="M67 33 A 24 24 0 1 0 67 67" 
        stroke={`url(#${id}-c-grad)`} 
        strokeWidth="11" 
        strokeLinecap="round" 
      />
      
      {/* Floating accent dot sliding along C */}
      <g
        className={animated ? "portal-logo-dot" : ""}
        style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}
      >
        <circle 
          cx="67" 
          cy="67" 
          r="5.5" 
          fill="#38BDF8" 
          filter={`url(#${id}-dot-glow)`}
        />
      </g>

      <defs>
        <linearGradient id={`${id}-c-grad`} x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.6" stopColor="#E2E8F0" />
          <stop offset="1" stopColor="#94A3B8" />
        </linearGradient>
        
        <linearGradient id={`${id}-ring-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop stopColor="#38BDF8" />
          <stop offset="1" stopColor="#818CF8" />
        </linearGradient>

        <filter id={`${id}-dot-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#38BDF8" floodOpacity="0.8" />
        </filter>

        <filter id={`${id}-strip-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#38BDF8" floodOpacity="0.5" />
        </filter>
      </defs>
    </svg>
  );
};

export default SleekPortalLogo;
