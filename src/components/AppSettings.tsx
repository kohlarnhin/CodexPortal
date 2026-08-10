import React from 'react';

interface AppSettingsProps {
  isEmailMaskingEnabled: boolean;
  onToggleEmailMasking: () => void;
  isAutoLaunchEnabled: boolean;
  isAutoLaunchLoading: boolean;
  onToggleAutoLaunch: (value: boolean) => void;
}

const ToggleSwitch = ({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) => (
  <div
    onClick={disabled ? undefined : onToggle}
    className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ${
      disabled ? 'opacity-50 cursor-not-allowed' : ''
    } ${checked ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'}`}
  >
    <span
      className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </div>
);

const AppSettings: React.FC<AppSettingsProps> = ({
  isEmailMaskingEnabled,
  onToggleEmailMasking,
  isAutoLaunchEnabled,
  isAutoLaunchLoading,
  onToggleAutoLaunch,
}) => {
  return (
    <div className="max-w-4xl mx-auto w-full pt-4">
      <div className="mb-8 shrink-0">
        <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">设置</h2>
        <p className="text-[14px] text-[#666666]">Codex Portal 本程序的应用级设置。</p>
      </div>

      <div className="bg-white border border-[#EAEAEA] rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-6 p-6 border-b border-[#EAEAEA]">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-[#F5F5F5] border border-[#EAEAEA] flex items-center justify-center text-[#555555]">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-black">邮箱脱敏</div>
              <div className="text-[12px] text-[#888888] mt-0.5">
                {isEmailMaskingEnabled ? '隐私保护已开启' : '正在显示原邮箱'} · 作用于当前账号与账号列表
              </div>
            </div>
          </div>
          <ToggleSwitch checked={isEmailMaskingEnabled} onToggle={onToggleEmailMasking} />
        </div>

        <div className="flex items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-[#F5F5F5] border border-[#EAEAEA] flex items-center justify-center text-[#555555]">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-black">开机自启动</div>
              <div className="text-[12px] text-[#888888] mt-0.5">
                登录系统后自动启动 Codex Portal
              </div>
            </div>
          </div>
          <ToggleSwitch
            checked={isAutoLaunchEnabled}
            disabled={isAutoLaunchLoading}
            onToggle={() => onToggleAutoLaunch(!isAutoLaunchEnabled)}
          />
        </div>
      </div>
    </div>
  );
};

export default AppSettings;
