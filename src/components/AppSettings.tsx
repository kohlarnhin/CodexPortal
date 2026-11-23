import React from 'react';
import { useQuotaQuietHours } from '../hooks/useQuotaQuietHours';
import type { useSystemTray } from '../hooks/useSystemTray';
import type { Appearance } from '../hooks/useAppearance';
import ToggleSwitch from './ToggleSwitch';
import SegmentedControl from './SegmentedControl';
import ModelPricingModal from './ModelPricingModal';
import McpInstallModal from './McpInstallModal';
import PageHeader from './ui/page-header';
import { Check, Eye, LoaderCircle, Moon, Palette, PanelTop, Plug, Power, Table } from 'lucide-react';

interface AppSettingsProps {
  appearance: Appearance;
  onChangeAppearance: (appearance: Appearance) => void;
  isEmailMaskingEnabled: boolean;
  onToggleEmailMasking: () => void;
  isAutoLaunchEnabled: boolean;
  isAutoLaunchLoading: boolean;
  isAutoLaunchReadOnly: boolean;
  onToggleAutoLaunch: (value: boolean) => void;
  systemTray: ReturnType<typeof useSystemTray>;
}

const APPEARANCE_OPTIONS = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
] as const;

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="bento-group-title px-1.5">{title}</h3>
      <div className="bento-group overflow-hidden">{children}</div>
    </section>
  );
}

function SettingsIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--button-fill)] text-muted-foreground">
      {children}
    </div>
  );
}

const AppSettings: React.FC<AppSettingsProps> = ({
  appearance,
  onChangeAppearance,
  isEmailMaskingEnabled,
  onToggleEmailMasking,
  isAutoLaunchEnabled,
  isAutoLaunchLoading,
  isAutoLaunchReadOnly,
  onToggleAutoLaunch,
  systemTray,
}) => {
  const quietHours = useQuotaQuietHours();
  const quietHoursDisabled = quietHours.isLoading || quietHours.isSaving || !quietHours.settings;
  const crossesMidnight = !!quietHours.settings
    && quietHours.settings.startTime > quietHours.settings.endTime;

  return (
    <div className="page-layout overflow-hidden">
      <PageHeader title="设置" description="Codex Portal 的外观、隐私与后台调度偏好。" />

      <div className="page-scroll space-y-5">
        {/* 外观 */}
        <SettingsGroup title="外观">
          <div className="bento-list-row">
            <div className="flex min-w-0 items-center gap-3">
              <SettingsIcon>
                <Palette size={15} />
              </SettingsIcon>
              <div className="min-w-0">
                <div className="text-subtitle font-medium text-foreground">主题</div>
                <div className="mt-0.5 text-label text-muted-foreground">
                  切换浅色、深色或跟随系统外观，与窗口边框同步生效
                </div>
              </div>
            </div>
            <SegmentedControl<Appearance>
              size="sm"
              label="外观主题"
              value={appearance}
              onChange={onChangeAppearance}
              options={APPEARANCE_OPTIONS}
            />
          </div>
        </SettingsGroup>

        {/* 通用与隐私 */}
        <SettingsGroup title="通用与隐私">
          <div className="bento-list-row">
            <div className="flex min-w-0 items-center gap-3">
              <SettingsIcon>
                <Eye size={15} />
              </SettingsIcon>
              <div className="min-w-0">
                <div className="text-subtitle font-medium text-foreground">邮箱脱敏</div>
                <div className="mt-0.5 text-label text-muted-foreground">
                  {isEmailMaskingEnabled ? '隐私保护已开启' : '正在显示原邮箱'} · 作用于账号页面与系统托盘
                </div>
              </div>
            </div>
            <ToggleSwitch label="邮箱脱敏" checked={isEmailMaskingEnabled} onToggle={onToggleEmailMasking} />
          </div>

          <div className="bento-list-row">
            <div className="flex min-w-0 items-center gap-3">
              <SettingsIcon>
                <Power size={15} />
              </SettingsIcon>
              <div className="min-w-0">
                <div className="text-subtitle font-medium text-foreground">开机自启动</div>
                <div className="mt-0.5 text-label text-muted-foreground">
                  {isAutoLaunchReadOnly
                    ? '开发模式下不修改系统登录项，请在已安装版本中设置'
                    : '登录系统后自动启动 Codex Portal'}
                </div>
              </div>
            </div>
            <ToggleSwitch
              label="开机自启动"
              checked={isAutoLaunchEnabled}
              disabled={isAutoLaunchLoading || isAutoLaunchReadOnly}
              onToggle={() => onToggleAutoLaunch(!isAutoLaunchEnabled)}
            />
          </div>

          <div className="border-t border-[var(--hairline-divider)]">
            <div className="bento-list-row">
              <div className="flex min-w-0 items-center gap-3">
                <SettingsIcon>
                  <PanelTop size={15} />
                </SettingsIcon>
                <div className="min-w-0">
                  <div className="text-subtitle font-medium text-foreground">系统托盘</div>
                  <div className="mt-0.5 text-label leading-relaxed text-muted-foreground">
                    显示当前账号第一窗口的剩余百分比，关闭窗口后可在后台继续运行
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
            {systemTray.error ? (
              <p role="alert" className="border-t border-[var(--hairline-divider)] px-4 py-2 text-label text-destructive">
                {systemTray.error}
              </p>
            ) : null}
          </div>
        </SettingsGroup>

        {/* 额度调度 */}
        <SettingsGroup title="额度调度">
          <div>
            <div className="bento-list-row">
              <div className="flex min-w-0 items-center gap-3">
                <SettingsIcon>
                  <Moon size={15} />
                </SettingsIcon>
                <div className="min-w-0">
                  <div className="text-subtitle font-medium text-foreground">免打扰</div>
                  <div className="mt-0.5 text-label text-muted-foreground">
                    {quietHours.settings?.enabled
                      ? '指定时段内暂停自动额度刷新与窗口激活'
                      : '已关闭 · 开启后在指定时段暂停自动刷新'}
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
              <div className="px-4 pb-4 pt-0">
                <div className="ml-11 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-[10px] bg-muted/65 px-3.5 py-2.5 dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-center gap-2.5 text-body text-muted-foreground">
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
                        className="bento-field h-8 w-[104px] px-2 text-center text-body tabular-nums disabled:opacity-50"
                      />
                      <span className="text-[var(--label)]">至</span>
                      <input
                        type="time"
                        step={60}
                        required
                        value={quietHours.settings.endTime}
                        disabled={quietHoursDisabled}
                        onChange={(e) => quietHours.updateSettingsDraft({ endTime: e.target.value })}
                        onBlur={(e) => void quietHours.commitTimeChange({ endTime: e.target.value })}
                        className="bento-field h-8 w-[104px] px-2 text-center text-body tabular-nums disabled:opacity-50"
                      />
                      {crossesMidnight && (
                        <span className="rounded-full bg-[var(--button-fill)] px-2 py-0.5 text-caption font-medium text-muted-foreground">
                          次日
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-label">
                    {quietHours.validationError ? (
                      <span role="alert" className="text-destructive">{quietHours.validationError}</span>
                    ) : quietHours.isSaving ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <LoaderCircle size={11} strokeWidth={2.5} className="animate-spin" />
                        保存中…
                      </span>
                    ) : quietHours.showSavedFeedback ? (
                      <span className="flex items-center gap-1 font-medium text-success animate-fade-in">
                        <Check size={12} strokeWidth={2.5} />
                        已保存
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="ml-11 mt-2 text-caption leading-relaxed text-[var(--label)]">
                  按电脑本地时间每日重复，时段内到期的刷新将自动顺延至结束后 1 分钟。
                </p>
              </div>
            ) : quietHours.isLoading ? (
              <p className="px-4 pb-3.5 text-label text-muted-foreground">正在读取免打扰设置…</p>
            ) : null}

            {quietHours.error ? (
              <p role="alert" className="border-t border-[var(--hairline-divider)] px-4 py-2 text-label text-destructive">
                {quietHours.error}
              </p>
            ) : null}
          </div>
        </SettingsGroup>

        {/* 集成与参考 */}
        <SettingsGroup title="集成与参考">
          <div className="bento-list-row">
            <div className="flex min-w-0 items-center gap-3">
              <SettingsIcon>
                <Table aria-hidden="true" size={15} />
              </SettingsIcon>
              <div className="min-w-0">
                <div className="text-subtitle font-medium text-foreground">模型价格</div>
                <div className="mt-0.5 text-label leading-relaxed text-muted-foreground">
                  查看内置模型的输入、缓存输入、输出单价与计费倍率
                </div>
              </div>
            </div>
            <ModelPricingModal />
          </div>

          <div className="bento-list-row">
            <div className="flex min-w-0 items-center gap-3">
              <SettingsIcon>
                <Plug aria-hidden="true" size={15} />
              </SettingsIcon>
              <div className="min-w-0">
                <div className="text-subtitle font-medium text-foreground">MCP 服务</div>
                <div className="mt-0.5 text-label leading-relaxed text-muted-foreground">
                  让 Codex 和 Claude Code 查看账号额度、请求智能切换
                </div>
              </div>
            </div>
            <McpInstallModal />
          </div>
        </SettingsGroup>
      </div>
    </div>
  );
};

export default AppSettings;
