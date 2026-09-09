import React from 'react';
import { useQuotaQuietHours } from '../hooks/useQuotaQuietHours';
import ToggleSwitch from './ToggleSwitch';

interface AppSettingsProps {
  isEmailMaskingEnabled: boolean;
  onToggleEmailMasking: () => void;
  isAutoLaunchEnabled: boolean;
  isAutoLaunchLoading: boolean;
  onToggleAutoLaunch: (value: boolean) => void;
}

const AppSettings: React.FC<AppSettingsProps> = ({
  isEmailMaskingEnabled,
  onToggleEmailMasking,
  isAutoLaunchEnabled,
  isAutoLaunchLoading,
  onToggleAutoLaunch,
}) => {
  const quietHours = useQuotaQuietHours();
  const quietHoursDisabled = quietHours.isLoading || quietHours.isSaving || !quietHours.settings;
  const crossesMidnight = !!quietHours.settings
    && quietHours.settings.startTime > quietHours.settings.endTime;

  return (
    <div className="page-layout pt-4 overflow-y-auto">
      <div className="mb-8 shrink-0">
        <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">设置</h2>
        <p className="text-[14px] text-[#666666]">Codex Portal 本程序的应用级设置。</p>
      </div>

      <div className="shrink-0 bg-white border border-[#EAEAEA] rounded-2xl shadow-sm overflow-hidden">
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
          <ToggleSwitch label="邮箱脱敏" checked={isEmailMaskingEnabled} onToggle={onToggleEmailMasking} />
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
            label="开机自启动"
            checked={isAutoLaunchEnabled}
            disabled={isAutoLaunchLoading}
            onToggle={() => onToggleAutoLaunch(!isAutoLaunchEnabled)}
          />
        </div>

        <div className="border-t border-[#EAEAEA]">
          <div className="flex items-center justify-between gap-6 p-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#EAEAEA] bg-[#F5F5F5] text-[#555555]">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z" /></svg>
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-black">免打扰</div>
                <div className="mt-0.5 text-[12px] text-[#888888]">
                  {quietHours.settings?.enabled ? '指定时段内暂停自动额度刷新与窗口激活' : '已关闭 · 开启后在指定时段暂停自动刷新'}
                </div>
              </div>
            </div>
            <ToggleSwitch
              label="免打扰"
              checked={quietHours.settings?.enabled ?? false}
              disabled={quietHoursDisabled}
              onToggle={() => void quietHours.toggleEnabled()}
            />
          </div>

          {quietHours.settings?.enabled ? (
            <div className="px-6 pb-6 pt-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-xl bg-[#F9F9F9] px-4 py-2.5 border border-[#EAEAEA]">
                <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-[#555555]">
                  <span className="font-medium text-black">生效时段</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      step={60}
                      required
                      value={quietHours.settings.startTime}
                      disabled={quietHoursDisabled}
                      onChange={(e) => quietHours.updateSettingsDraft({ startTime: e.target.value })}
                      onBlur={(e) => void quietHours.commitTimeChange({ startTime: e.target.value })}
                      className="h-8 w-[105px] rounded-lg border border-[#E0E0E0] bg-white px-2 text-center text-[13px] font-medium tabular-nums text-black outline-none transition-all hover:border-[#CCCCCC] focus:border-black focus:ring-1 focus:ring-black/10 disabled:opacity-50"
                    />
                    <span className="text-[#888888]">至</span>
                    <input
                      type="time"
                      step={60}
                      required
                      value={quietHours.settings.endTime}
                      disabled={quietHoursDisabled}
                      onChange={(e) => quietHours.updateSettingsDraft({ endTime: e.target.value })}
                      onBlur={(e) => void quietHours.commitTimeChange({ endTime: e.target.value })}
                      className="h-8 w-[105px] rounded-lg border border-[#E0E0E0] bg-white px-2 text-center text-[13px] font-medium tabular-nums text-black outline-none transition-all hover:border-[#CCCCCC] focus:border-black focus:ring-1 focus:ring-black/10 disabled:opacity-50"
                    />
                    {crossesMidnight && (
                      <span className="text-[11px] font-medium text-[#777777] bg-black/5 px-1.5 py-0.5 rounded">次日</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[12px]">
                  {quietHours.validationError ? (
                    <span role="alert" className="text-red-600">{quietHours.validationError}</span>
                  ) : quietHours.isSaving ? (
                    <span className="text-[#888888] flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      保存中…
                    </span>
                  ) : quietHours.showSavedFeedback ? (
                    <span className="text-emerald-600 font-medium flex items-center gap-1 animate-fade-in">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      已保存
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#888888] px-1">
                按电脑本地时间每日重复。时段内到期的刷新将自动顺延至结束后 1 分钟。
              </p>
            </div>
          ) : quietHours.isLoading ? (
            <p className="px-6 pb-4 text-[12px] text-[#888888]">正在读取免打扰设置…</p>
          ) : null}
          {quietHours.error ? <p role="alert" className="px-6 pb-4 text-[12px] text-red-600">{quietHours.error}</p> : null}
        </div>
      </div>
    </div>
  );
};

export default AppSettings;
