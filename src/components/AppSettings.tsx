import React from 'react';
import { useQuotaQuietHours } from '../hooks/useQuotaQuietHours';
import type { useSystemTray } from '../hooks/useSystemTray';
import ToggleSwitch from './ToggleSwitch';
import ModelPricingModal from './ModelPricingModal';
import PageHeader from './ui/page-header';

interface AppSettingsProps {
  isEmailMaskingEnabled: boolean;
  onToggleEmailMasking: () => void;
  isAutoLaunchEnabled: boolean;
  isAutoLaunchLoading: boolean;
  onToggleAutoLaunch: (value: boolean) => void;
  systemTray: ReturnType<typeof useSystemTray>;
}

const AppSettings: React.FC<AppSettingsProps> = ({
  isEmailMaskingEnabled,
  onToggleEmailMasking,
  isAutoLaunchEnabled,
  isAutoLaunchLoading,
  onToggleAutoLaunch,
  systemTray,
}) => {
  const quietHours = useQuotaQuietHours();
  const quietHoursDisabled = quietHours.isLoading || quietHours.isSaving || !quietHours.settings;
  const crossesMidnight = !!quietHours.settings
    && quietHours.settings.startTime > quietHours.settings.endTime;

  return (
    <div className="page-layout pt-4 overflow-hidden">
      <PageHeader title="设置" description="Codex Portal 本程序的应用级设置。" />

      <div className="min-h-0 overflow-y-auto overscroll-contain rounded-xl border bg-card shadow-xs">
        <div className="flex items-center justify-between gap-6 px-5 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-foreground">邮箱脱敏</div>
              <div className="text-[12px] text-muted-foreground mt-0.5">
                {isEmailMaskingEnabled ? '隐私保护已开启' : '正在显示原邮箱'} · 作用于账号页面与系统托盘
              </div>
            </div>
          </div>
          <ToggleSwitch label="邮箱脱敏" checked={isEmailMaskingEnabled} onToggle={onToggleEmailMasking} />
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-foreground">开机自启动</div>
              <div className="text-[12px] text-muted-foreground mt-0.5">
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

        <div className="border-t">
          <div className="flex items-center justify-between gap-6 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 10h10M7 10v2M10 10v2"/></svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">系统托盘</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  进度条显示当前账号第一窗口的剩余百分比，点击查看额度、快捷切换账号
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground/70">
                  开启后关闭窗口可继续在后台运行，通过托盘菜单退出程序
                </div>
              </div>
            </div>
            <ToggleSwitch
              label="系统托盘"
              checked={systemTray.isEnabled}
              disabled={systemTray.isLoading || systemTray.isSaving}
              onToggle={() => void systemTray.toggle()}
            />
          </div>
          {systemTray.error ? <p role="alert" className="px-5 pb-4 text-[12px] text-destructive">{systemTray.error}</p> : null}
        </div>

        <div className="border-t">
          <div className="flex items-center justify-between gap-6 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z" /></svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">免打扰</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
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
            <div className="px-5 pb-4 pt-0">
              <div className="ml-11 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-lg border bg-muted/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
                  <span className="font-medium text-foreground">生效时段</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      step={60}
                      required
                      value={quietHours.settings.startTime}
                      disabled={quietHoursDisabled}
                      onChange={(e) => quietHours.updateSettingsDraft({ startTime: e.target.value })}
                      onBlur={(e) => void quietHours.commitTimeChange({ startTime: e.target.value })}
                      className="h-8 w-[105px] rounded-md border border-input bg-background px-2 text-center text-[13px] tabular-nums text-foreground shadow-xs outline-none transition-[color,box-shadow] focus:border-neutral-700 disabled:opacity-50"
                    />
                    <span className="text-muted-foreground">至</span>
                    <input
                      type="time"
                      step={60}
                      required
                      value={quietHours.settings.endTime}
                      disabled={quietHoursDisabled}
                      onChange={(e) => quietHours.updateSettingsDraft({ endTime: e.target.value })}
                      onBlur={(e) => void quietHours.commitTimeChange({ endTime: e.target.value })}
                      className="h-8 w-[105px] rounded-md border border-input bg-background px-2 text-center text-[13px] tabular-nums text-foreground shadow-xs outline-none transition-[color,box-shadow] focus:border-neutral-700 disabled:opacity-50"
                    />
                    {crossesMidnight && (
                      <span className="text-[11px] font-medium text-muted-foreground bg-black/5 px-1.5 py-0.5 rounded-md">次日</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[12px]">
                  {quietHours.validationError ? (
                    <span role="alert" className="text-destructive">{quietHours.validationError}</span>
                  ) : quietHours.isSaving ? (
                    <span className="text-muted-foreground flex items-center gap-1">
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
              <p className="ml-11 mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                按电脑本地时间每日重复。时段内到期的刷新将自动顺延至结束后 1 分钟。
              </p>
            </div>
          ) : quietHours.isLoading ? (
            <p className="px-5 pb-4 text-[12px] text-muted-foreground">正在读取免打扰设置…</p>
          ) : null}
          {quietHours.error ? <p role="alert" className="px-5 pb-4 text-[12px] text-destructive">{quietHours.error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-6 border-t px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="16" height="16" rx="2" /><path d="M3 9h18M9 9v12M9 15h12" /></svg>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-foreground">模型价格</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                查看内置模型的输入、缓存输入、输出单价与计费倍率
              </div>
            </div>
          </div>
          <ModelPricingModal />
        </div>
      </div>
    </div>
  );
};

export default AppSettings;
