import React from 'react';

interface LogoProps {
  className?: string;
}

// ==========================================
// 设计方案 A: [Sleek Portal] 
// 这是一个更加精致、Apple-like 的现代扁平风格 Logo
// 背景深邃，内部是一个金属质感的极简 C，外面环绕一个科技感的光环
// ==========================================
export const SleekPortalLogo: React.FC<LogoProps> = ({ className = "w-7 h-7" }) => (
  <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Dark rounded background */}
    <rect width="100" height="100" rx="24" fill="#000000" />
    
    {/* Outer Portal Ring (Subtle base) */}
    <path 
      d="M77 23 A 38 38 0 1 0 77 77" 
      stroke="#1E1E24" 
      strokeWidth="3" 
      strokeLinecap="round" 
    />
    
    {/* Outer Portal Ring (Glowing accent) */}
    <path 
      d="M77 23 A 38 38 0 0 1 88 50" 
      stroke="url(#ring_grad)" 
      strokeWidth="3" 
      strokeLinecap="round" 
    />
    
    {/* Inner 'C' - Metallic / Silver gradient */}
    <path 
      d="M67 33 A 24 24 0 1 0 67 67" 
      stroke="url(#c_grad)" 
      strokeWidth="11" 
      strokeLinecap="round" 
    />
    
    {/* Floating accent dot at the tail of 'C' */}
    <circle cx="67" cy="67" r="5.5" fill="#38BDF8" />

    <defs>
      <linearGradient id="c_grad" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" />
        <stop offset="0.6" stopColor="#E2E8F0" />
        <stop offset="1" stopColor="#94A3B8" />
      </linearGradient>
      
      <linearGradient id="ring_grad" x1="70" y1="10" x2="90" y2="60" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38BDF8" />
        <stop offset="1" stopColor="#818CF8" />
      </linearGradient>
    </defs>
  </svg>
);

// 默认导出新的高质量设计
export default SleekPortalLogo;
