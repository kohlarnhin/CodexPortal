import React, { useEffect, useState, useCallback } from 'react';
import { useConfig, parseConfig, CodexConfig, ConfigParseError } from '../hooks/useConfig';
import { stringify } from 'smol-toml';
import Select, { type Option } from './Select';
import ModelSelect from './ModelSelect';
import ToggleSwitch from './ToggleSwitch';
import TomlEditor from './config/TomlEditor';
import Button from './ui/button';
import { errorMessage, toast } from './ui/toast';
import SegmentedControl from './SegmentedControl';
import DiffModal, { DiffItem } from './DiffModal';
import { OFFICIAL_FEATURES, OFFICIAL_FEATURE_KEYS } from '../utils/codexFeatures';
import { collectConfigDiffs } from '../utils/configDiff';
import { cn } from '../lib/utils';
import { CircleAlert, File, LoaderCircle, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import PageHeader from './ui/page-header';

interface ConfigDraft {
  base: CodexConfig | null;
  baseToml: string;
  value: CodexConfig | null;
  toml: string;
  raw: boolean;
}

type PendingSave =
  | { kind: 'raw'; content: string; expectedContent: string }
  | { kind: 'structured'; value: CodexConfig; base: CodexConfig };

const BUILTIN_MODELS = [
  'gpt-6.2-astra',
  'gpt-6.2-sol',
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
];

function toTomlError(err: unknown) {
  return {
    message: err instanceof Error ? err.message : String(err),
    line: err instanceof ConfigParseError ? err.line : null,
  };
}

const REASONING_OPTIONS = [
  { value: '', label: '使用模型默认设置' },
  { value: 'low', label: 'Low（轻量推理）' },
  { value: 'medium', label: 'Medium（平衡适中）' },
  { value: 'high', label: 'High（深度思考）' },
  { value: 'xhigh', label: 'Extra High（极高深度）' },
  { value: 'max', label: 'Max（最大思考配额）' },
  { value: 'ultra', label: 'Ultra（顶格算力消耗）' },
];

const SANDBOX_OPTIONS = [
  { value: '', label: '使用 Codex 默认设置' },
  { value: 'read-only', label: 'Read Only（只读安全沙盒）' },
  { value: 'workspace-write', label: 'Workspace Write（仅允许工作区写入）' },
  { value: 'danger-full-access', label: 'Danger - Full Access（完整主机访问）' },
];

const APPROVAL_OPTIONS = [
  { value: 'on-request', label: 'On Request（模型请求时询问）' },
  { value: 'never', label: 'Never（从不审批直接执行）' },
];

const PERSONALITY_OPTIONS = [
  { value: '', label: '使用 Codex 默认设置' },
  { value: 'none', label: 'None（不加入内置风格说明）' },
];
const DEPRECATED_PERSONALITY_VALUES = ['friendly', 'pragmatic'];

function withCurrentValue(options: Option[], value: string, label: string): Option[] {
  return value && !options.some(option => option.value === value) ? [...options, { value, label }] : options;
}

interface SettingRowProps {
  label: string;
  configKey: string;
  description: string;
  htmlFor?: string;
  descriptionId?: string;
  warning?: string | null;
  children: React.ReactNode;
}

/** 基础设置的一行：左侧名称 + 配置键 + 说明，右侧控件。 */
function SettingRow({ label, configKey, description, htmlFor, descriptionId, warning, children }: SettingRowProps) {
  return (
    <div className="bento-list-row transition-colors hover:bg-[var(--hover)]">
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-subtitle font-medium text-foreground">{label}</label>
          ) : (
            <span className="text-subtitle font-medium text-foreground">{label}</span>
          )}
          <code className="rounded-full bg-[var(--button-fill)] px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
            {configKey}
          </code>
        </div>
        <p id={descriptionId} className="text-label leading-normal text-muted-foreground">{description}</p>
        {warning && (
          <p className="mt-1 flex items-center gap-1.5 text-label text-warning">
            <TriangleAlert size={12} className="shrink-0" />
            {warning}
          </p>
        )}
      </div>
      <div className="flex w-60 shrink-0 justify-end">{children}</div>
    </div>
  );
}

interface SaveBarProps {
  status: React.ReactNode;
  hasDraft: boolean;
  isSaving: boolean;
  disabled: boolean;
  canSave: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

/** 三个页签共用的底部操作条：状态 + 放弃 / 保存。 */
function SaveBar({ status, hasDraft, isSaving, disabled, canSave, onDiscard, onSave }: SaveBarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--hairline-divider)] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-label">
        {hasDraft ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-warning">
            <span className="bento-status-dot" data-tone="warning" aria-hidden="true" />
            存在未保存的修改
          </span>
        ) : (
          status
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="mr-1 hidden items-center gap-1 text-caption text-[var(--label)] @min-[640px]/page:inline-flex">
          <kbd className="rounded-[5px] bg-[var(--button-fill)] px-1.5 py-0.5 font-mono text-[10.5px] text-foreground">⌘S</kbd>
          保存前预览差异
        </span>
        {hasDraft && (
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={disabled}>
            放弃修改
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={disabled || !canSave}>
          {isSaving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
          {isSaving ? '保存中…' : '保存修改'}
        </Button>
      </div>
    </div>
  );
}

function configDiffItems(before: CodexConfig, after: CodexConfig): DiffItem[] {
  const displayValue = (value: unknown, path: string): unknown => {
    if (/api_key|token|secret|authorization/i.test(path)) return value === undefined ? undefined : '••••••';
    if (Array.isArray(value)) return value.map(item => displayValue(item, path));
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayValue(item, `${path}.${key}`)]));
    }
    return value;
  };
  return collectConfigDiffs(before, after).map(diff => ({
    key: diff.path,
    oldVal: displayValue(diff.oldValue, diff.path),
    newVal: displayValue(diff.newValue, diff.path),
  }));
}

export default function Settings() {
  const { config, rawToml, isLoading, isRefreshing, error, hasLoadedFile, saveConfig, saveRawConfig, refresh } = useConfig(true);
  const [activeTab, setActiveTab] = useState<'general' | 'features' | 'advanced'>('general');
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [tomlError, setTomlError] = useState<{ message: string; line: number | null } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<DiffItem[]>([]);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);

  const localConfig = draft ? draft.value : config;
  const localToml = draft?.toml ?? rawToml;
  const editingDisabled = isSaving || showDiffModal || !hasLoadedFile;

  const setLocalConfig = (value: CodexConfig) => {
    if (!localConfig || editingDisabled || (!draft?.raw && !!error)) return;
    try {
      const toml = stringify(value);
      setDraft(previous => ({
        base: previous ? previous.base : config,
        baseToml: previous?.baseToml ?? rawToml,
        value,
        toml,
        raw: previous?.raw ?? false,
      }));
      setTomlError(null);
    } catch {
      toast.error('无法生成 TOML，请检查配置值。');
    }
  };

  const setLocalToml = (toml: string) => {
    if (editingDisabled) return;
    let value: CodexConfig | null = null;
    try {
      value = parseConfig(toml);
      setTomlError(null);
    } catch (err) {
      setTomlError(toTomlError(err));
    }
    setDraft(previous => ({
      base: previous ? previous.base : config,
      baseToml: previous?.baseToml ?? rawToml,
      value,
      toml,
      raw: true,
    }));
  };

  const discardDraft = () => {
    setDraft(null);
    setTomlError(null);
    void refresh();
  };

  const updateSetting = (
    key: 'sandbox_mode' | 'approval_policy' | 'model_reasoning_effort' | 'personality' | 'suppress_unstable_features_warning',
    value: any
  ) => {
    if (!localConfig || value === '__custom__') return;
    const updated = { ...localConfig };
    if (value !== '' && value !== undefined && value !== null) {
      updated[key] = value;
    } else {
      delete updated[key];
    }
    setLocalConfig(updated);
  };

  const handleSave = useCallback(() => {
    if (!draft || editingDisabled) return;
    if (draft.raw) {
      try {
        parseConfig(draft.toml);
      } catch (err) {
        setTomlError(toTomlError(err));
        setActiveTab('advanced');
        return;
      }
      if (draft.toml === draft.baseToml) {
        setDraft(null);
        setTomlError(null);
        toast.info('无任何更改');
        return;
      }
      if (draft.baseToml !== rawToml) {
        toast.error('编辑内容已保留。请先复制需要保留的内容，再重新载入后编辑。', { title: '本地配置已被外部修改', duration: 0 });
        return;
      }
      const diffs = draft.base && draft.value ? configDiffItems(draft.base, draft.value) : [{
        key: 'TOML 格式', oldVal: '格式无效', newVal: '已修正',
      }];
      setPendingDiffs(diffs.length ? diffs : [{
        key: '注释与格式', oldVal: '原文本', newVal: '已修改（配置值未变）',
      }]);
      setPendingSave({ kind: 'raw', content: draft.toml, expectedContent: draft.baseToml });
      setShowDiffModal(true);
      return;
    }
    if (!draft.base || !draft.value || error) return;
    const diffs = configDiffItems(draft.base, draft.value);
    if (diffs.length === 0) {
      setDraft(null);
      toast.info('无任何更改');
      return;
    }
    setPendingDiffs(diffs);
    setPendingSave({ kind: 'structured', value: draft.value, base: draft.base });
    setShowDiffModal(true);
  }, [draft, editingDisabled, rawToml, error]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const confirmSave = async () => {
    if (!pendingSave || isSaving) return;
    setShowDiffModal(false);
    setIsSaving(true);
    try {
      if (pendingSave.kind === 'raw') {
        await saveRawConfig(pendingSave.content, pendingSave.expectedContent);
      } else {
        await saveConfig(pendingSave.value, pendingSave.base);
      }
      setDraft(null);
      setTomlError(null);
      setPendingSave(null);
      toast.success('已保存到本地 config.toml');
    } catch (err) {
      toast.error(errorMessage(err), { title: '保存失败' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-layout">
        <div className="page-header">
          <div className="h-6 w-28 rounded-md bg-[var(--button-fill)] animate-pulse" />
        </div>
        <div className="page-body">
          <div className="h-56 w-full rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
        </div>
      </div>
    );
  }

  const canSaveStructured = !!draft && (draft.raw || !error);
  const saveBarProps = {
    hasDraft: !!draft,
    isSaving,
    disabled: editingDisabled,
    onDiscard: discardDraft,
    onSave: handleSave,
  };
  const enabledFeatureCount = localConfig
    ? OFFICIAL_FEATURE_KEYS.filter(key => localConfig.features?.[key] ?? OFFICIAL_FEATURES[key].defaultEnabled ?? false).length
    : 0;
  const approvalIsCustom = typeof localConfig?.approval_policy === 'object';
  const sandboxWarning = localConfig?.sandbox_mode === 'danger-full-access'
    ? 'Codex 可读写任意文件并访问网络，请仅在可信环境中使用'
    : null;
  const approvalPolicy = typeof localConfig?.approval_policy === 'string' ? localConfig.approval_policy : '';
  const approvalWarning = approvalPolicy === 'untrusted'
    ? 'Codex 已不再支持 untrusted，保留该值会导致 Codex 无法加载配置'
    : approvalPolicy === 'never'
      ? localConfig?.sandbox_mode === 'danger-full-access'
        ? '与完整主机访问同时使用时，所有操作都不经确认直接执行'
        : '命令与写入不再弹出确认，失败时也不会请求授权'
      : null;
  const personality = typeof localConfig?.personality === 'string' ? localConfig.personality : '';
  const personalityDeprecated = DEPRECATED_PERSONALITY_VALUES.includes(personality);
  const personalityWarning = !personality || personality === 'none'
    ? null
    : personalityDeprecated
      ? 'Codex 已废弃风格选择，该取值不再生效'
      : 'Codex 不支持该取值，保留会导致 Codex 无法加载配置';

  return (
    <div className="page-layout">
      <PageHeader
        className="relative z-10"
        title="配置管理"
        center={
          <SegmentedControl<'general' | 'features' | 'advanced'>
            size="sm"
            label="配置分区"
            value={activeTab}
            onChange={tabId => {
              setActiveTab(tabId);
              void refresh();
            }}
            disabled={isSaving || showDiffModal}
            options={[
              { id: 'general', label: '基础设置' },
              { id: 'features', label: '功能开关' },
              { id: 'advanced', label: 'TOML 原文' },
            ]}
          />
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void refresh(); }}
            disabled={isRefreshing || isSaving || showDiffModal}
            title="重新从本地 config.toml 读取配置"
          >
            <RotateCcw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? '读取中…' : '重新读取'}
          </Button>
        }
      />

      <div className="page-body gap-3 overflow-hidden">
        {error && (!draft?.raw || !hasLoadedFile) && (
          <div role="alert" className="bento-card flex shrink-0 items-start gap-2 px-4 py-2.5 text-body text-destructive">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab !== 'advanced' && !localConfig && (
            <div className="bento-empty flex-1">
              <p className="mb-4 text-body text-muted-foreground">配置格式有效后即可使用快捷设置。</p>
              <Button size="sm" onClick={() => setActiveTab('advanced')}>前往 TOML 原文编辑</Button>
            </div>
          )}

          {/* 基础设置 */}
          {activeTab === 'general' && localConfig && (
            <div className="bento-group flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SettingRow
                  label="模型选择"
                  configKey="model"
                  description="可选择预设模型或直接输入模型名，留空使用默认模型"
                  htmlFor="codex-model"
                  descriptionId="codex-model-hint"
                >
                  <ModelSelect
                    id="codex-model"
                    describedBy="codex-model-hint"
                    value={localConfig.model || ''}
                    onChange={value => {
                      const updated = { ...localConfig };
                      if (value) updated.model = value;
                      else delete updated.model;
                      setLocalConfig(updated);
                    }}
                    disabled={editingDisabled}
                    models={BUILTIN_MODELS}
                    className="w-60"
                  />
                </SettingRow>

                <SettingRow
                  label="思考程度"
                  configKey="model_reasoning_effort"
                  description="针对具备深度思考能力的模型调节推理深度与配额预算"
                >
                  <Select
                    value={localConfig.model_reasoning_effort || ''}
                    onChange={value => updateSetting('model_reasoning_effort', value)}
                    disabled={editingDisabled}
                    className="w-60"
                    align="right"
                    options={REASONING_OPTIONS}
                  />
                </SettingRow>

                <SettingRow
                  label="沙盒安全模式"
                  configKey="sandbox_mode"
                  description="控制代码执行环境对宿主机文件系统与网络的隔离级别"
                  warning={sandboxWarning}
                >
                  <Select
                    value={localConfig.sandbox_mode || ''}
                    onChange={value => updateSetting('sandbox_mode', value)}
                    disabled={editingDisabled}
                    className="w-60"
                    align="right"
                    options={SANDBOX_OPTIONS}
                  />
                </SettingRow>

                <SettingRow
                  label="审批策略"
                  configKey="approval_policy"
                  description="Shell 命令执行与文件写入等敏感操作的授权门禁"
                  warning={approvalWarning}
                >
                  <Select
                    value={typeof localConfig.approval_policy === 'object' ? '__custom__' : localConfig.approval_policy || ''}
                    onChange={value => updateSetting('approval_policy', value)}
                    disabled={editingDisabled}
                    className="w-60"
                    align="right"
                    options={withCurrentValue([
                      { value: '', label: '使用 Codex 默认设置' },
                      ...(approvalIsCustom ? [{ value: '__custom__', label: '自定义细粒度审批' }] : []),
                      ...APPROVAL_OPTIONS,
                    ], approvalPolicy, approvalPolicy === 'untrusted' ? 'Untrusted（Codex 已不支持）' : `${approvalPolicy}（当前值）`)}
                  />
                </SettingRow>

                <SettingRow
                  label="回复风格"
                  configKey="personality"
                  description="Codex 已废弃风格切换，仅 None 仍生效：不在模型指令中加入内置风格说明"
                  warning={personalityWarning}
                >
                  <Select
                    value={personality}
                    onChange={value => updateSetting('personality', value)}
                    disabled={editingDisabled}
                    className="w-60"
                    align="right"
                    options={withCurrentValue(
                      PERSONALITY_OPTIONS,
                      personality,
                      personalityDeprecated ? `${personality}（已废弃，不再生效）` : `${personality}（Codex 不支持）`,
                    )}
                  />
                </SettingRow>

                <SettingRow
                  label="隐藏实验特性警告"
                  configKey="suppress_unstable_features_warning"
                  description="开启新特性时静默运行，不弹出不稳定功能横幅"
                >
                  <ToggleSwitch
                    checked={Boolean(localConfig.suppress_unstable_features_warning)}
                    label="隐藏实验特性警告"
                    disabled={editingDisabled}
                    onToggle={() => setLocalConfig({
                      ...localConfig,
                      suppress_unstable_features_warning: !localConfig.suppress_unstable_features_warning,
                    })}
                  />
                </SettingRow>
              </div>

              <SaveBar
                {...saveBarProps}
                canSave={canSaveStructured}
                status={
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="bento-status-dot" data-tone="running" aria-hidden="true" />
                    config.toml 已同步
                  </span>
                }
              />
            </div>
          )}

          {/* 功能开关 */}
          {activeTab === 'features' && localConfig && (
            <div className="bento-group flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
                <div className="grid grid-cols-1 @min-[620px]/page:grid-cols-2 gap-x-4 gap-y-1">
                  {OFFICIAL_FEATURE_KEYS.map((key) => {
                    const feature = OFFICIAL_FEATURES[key];
                    const enabled = localConfig.features?.[key] ?? feature.defaultEnabled ?? false;
                    const toggleFeature = () => {
                      if (editingDisabled) return;
                      setLocalConfig({
                        ...localConfig,
                        features: {
                          ...(localConfig.features || {}),
                          [key]: !enabled,
                        },
                      });
                    };
                    return (
                      <div
                        key={key}
                        onClick={toggleFeature}
                        title={feature.description ? `${feature.label}：${feature.description}` : feature.label}
                        className={cn(
                          'flex cursor-pointer items-center justify-between rounded-[10px] px-3 py-2.5 transition-colors select-none',
                          enabled ? 'bg-muted/65 hover:bg-muted dark:bg-white/[0.05]' : 'hover:bg-[var(--hover)]',
                        )}
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-body font-medium text-foreground">
                              {feature.label}
                            </span>
                            <code className="shrink-0 truncate font-mono text-[10.5px] text-[var(--label)]">
                              {key}
                            </code>
                            {feature.defaultEnabled && (
                              <span
                                title="官方默认开启：未配置时也生效"
                                className="shrink-0 rounded-full bg-[var(--button-fill)] px-1.5 py-px text-[10px] font-medium text-muted-foreground"
                              >
                                默认
                              </span>
                            )}
                          </div>
                          {feature.description && (
                            <p className="mt-0.5 truncate text-caption text-muted-foreground">
                              {feature.description}
                            </p>
                          )}
                        </div>
                        <ToggleSwitch
                          checked={enabled}
                          label={feature.label}
                          disabled={editingDisabled}
                          onToggle={toggleFeature}
                          size="sm"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <SaveBar
                {...saveBarProps}
                canSave={canSaveStructured}
                status={
                  <span className="text-muted-foreground tabular-nums">
                    已开启 {enabledFeatureCount} / {OFFICIAL_FEATURE_KEYS.length} 项官方特性
                  </span>
                }
              />
            </div>
          )}

          {/* 高级配置 (TOML) — Bento 深色控制台风格 */}
          {activeTab === 'advanced' && (
            <div className="bento-group flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="bento-console flex-1 rounded-b-none border-0">
                <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
                  <div className="flex items-center gap-1.5 font-mono text-[12px] text-[#e5e5ea]">
                    <File size={13} className="shrink-0 text-[#8e8e93]" />
                    <span>config.toml</span>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[11px] text-[#8e8e93] tabular-nums">
                      {localToml.split('\n').length} 行 · {localToml.length} 字符
                    </span>
                    {tomlError ? (
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#ff453a]">
                        <span className="bento-status-dot" data-tone="error" aria-hidden="true" />
                        {tomlError.line ? `第 ${tomlError.line} 行语法错误` : '语法错误'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#a1a1a6]">
                        <span className="bento-status-dot" data-tone="running" aria-hidden="true" />
                        语法有效
                      </span>
                    )}
                  </div>
                </div>

                <TomlEditor
                  value={localToml}
                  onChange={setLocalToml}
                  disabled={editingDisabled}
                  errorLine={tomlError?.line}
                />

                {tomlError && (
                  <div role="alert" className="flex shrink-0 items-center gap-2 border-t border-white/[0.08] bg-[#ff453a]/12 px-4 py-2 text-label text-[#ff6961]">
                    <CircleAlert size={14} className="shrink-0" />
                    <span className="font-mono">{tomlError.message}</span>
                  </div>
                )}
              </div>

              <SaveBar
                {...saveBarProps}
                canSave={!!draft}
                status={<span className="text-muted-foreground">直接编辑原始 TOML，注释与格式原样保留</span>}
              />
            </div>
          )}
        </div>
      </div>

      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        onConfirm={confirmSave}
        diffs={pendingDiffs}
      />
    </div>
  );
}
