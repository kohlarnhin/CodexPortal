import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useConfig, parseConfig, CodexConfig } from '../hooks/useConfig';
import { stringify } from 'smol-toml';
import Select, { Option } from './Select';
import ToggleSwitch from './ToggleSwitch';
import SegmentedControl from './SegmentedControl';
import DiffModal, { DiffItem } from './DiffModal';
import { OFFICIAL_FEATURES, OFFICIAL_FEATURE_KEYS } from '../utils/codexFeatures';
import { collectConfigDiffs } from '../utils/configDiff';
import { cn } from '../lib/utils';

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

const BUILTIN_MODELS: Option[] = [
  { value: 'gpt-6-astra', label: 'gpt-6-astra' },
  { value: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
  { value: 'gpt-5.6-terra', label: 'gpt-5.6-terra' },
  { value: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
  { value: 'gpt-5.5', label: 'gpt-5.5' },
];

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
  const [tomlError, setTomlError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<DiffItem[]>([]);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);

  const localConfig = draft ? draft.value : config;
  const localToml = draft?.toml ?? rawToml;
  const editingDisabled = isSaving || showDiffModal || !hasLoadedFile;

  const modelOptions = useMemo(() => {
    const list: Option[] = [
      { value: '', label: '使用默认模型' },
      ...BUILTIN_MODELS,
    ];
    if (localConfig?.model && !list.some(opt => opt.value === localConfig.model)) {
      list.push({ value: localConfig.model, label: localConfig.model });
    }
    return list;
  }, [localConfig?.model]);

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
      setSaveMessage(null);
    } catch {
      setSaveMessage({ type: 'error', text: '无法生成 TOML，请检查配置值。' });
    }
  };

  const setLocalToml = (toml: string) => {
    if (editingDisabled) return;
    let value: CodexConfig | null = null;
    try {
      value = parseConfig(toml);
      setTomlError(null);
    } catch (err) {
      setTomlError(err instanceof Error ? err.message : String(err));
    }
    setDraft(previous => ({
      base: previous ? previous.base : config,
      baseToml: previous?.baseToml ?? rawToml,
      value,
      toml,
      raw: true,
    }));
    setSaveMessage(null);
  };

  const discardDraft = () => {
    setDraft(null);
    setTomlError(null);
    setSaveMessage(null);
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
    setSaveMessage(null);
    if (draft.raw) {
      try {
        parseConfig(draft.toml);
      } catch (err) {
        setTomlError(err instanceof Error ? err.message : String(err));
        setActiveTab('advanced');
        return;
      }
      if (draft.toml === draft.baseToml) {
        setDraft(null);
        setTomlError(null);
        setSaveMessage({ type: 'success', text: '无任何更改' });
        return;
      }
      if (draft.baseToml !== rawToml) {
        setSaveMessage({ type: 'error', text: '本地配置已被外部修改，编辑内容已保留。请先复制需要保留的内容，再重新载入后编辑。' });
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
      setSaveMessage({ type: 'success', text: '无任何更改' });
      return;
    }
    setPendingDiffs(diffs);
    setPendingSave({ kind: 'structured', value: draft.value, base: draft.base });
    setShowDiffModal(true);
  }, [draft, editingDisabled, rawToml, error]);

  // 全局快捷键 ⌘S / Ctrl+S 保存
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
    setSaveMessage(null);
    try {
      if (pendingSave.kind === 'raw') {
        await saveRawConfig(pendingSave.content, pendingSave.expectedContent);
      } else {
        await saveConfig(pendingSave.value, pendingSave.base);
      }
      setDraft(null);
      setTomlError(null);
      setPendingSave(null);
      setSaveMessage({ type: 'success', text: '已保存到本地 config.toml' });
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-layout pt-4">
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-8 bg-neutral-100 rounded w-1/4 mb-4"></div>
          <div className="h-44 bg-neutral-100 rounded-xl w-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-layout pt-4">
      {/* 头部标题栏 */}
      <div className="page-header relative z-10 mb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-[20px] font-semibold text-neutral-900 tracking-tight">配置管理</h2>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={isRefreshing || isSaving || showDiffModal}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-all cursor-pointer disabled:opacity-50"
              title="重新从本地 config.toml 读取配置"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isRefreshing ? 'animate-spin' : ''}>
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              <span>{isRefreshing ? '读取中...' : '刷新'}</span>
            </button>
          </div>
          <p className="text-[13px] text-neutral-500 mt-1">
            仅支持 OpenAI 官方订阅，配置修改后保存到本地 <code className="font-mono text-neutral-700 bg-neutral-100 px-1 py-0.5 rounded text-[11.5px]">config.toml</code>。
          </p>
        </div>

        {saveMessage && (
          <div role={saveMessage.type === 'error' ? 'alert' : 'status'} className={cn(
            "px-3 py-1.5 rounded-lg text-[12.5px] font-medium animate-fade-in shadow-2xs flex items-center gap-2",
            saveMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-red-50 text-red-700 border border-red-200/60'
          )}>
            <span>{saveMessage.text}</span>
            <button onClick={() => setSaveMessage(null)} className="text-neutral-400 hover:text-neutral-700 ml-1 text-[13px] cursor-pointer">×</button>
          </div>
        )}
      </div>

      {/* 现代分段滑动 Tab 栏 */}
      <SegmentedControl<'general' | 'features' | 'advanced'>
        value={activeTab}
        onChange={tabId => {
          setActiveTab(tabId);
          void refresh();
        }}
        disabled={isSaving || showDiffModal}
        className="mb-3.5 self-start"
        options={[
          { id: 'general', label: '基础设置' },
          { id: 'features', label: '功能开关' },
          { id: 'advanced', label: '高级配置 (TOML)' },
        ]}
      />

      {error && (!draft?.raw || !hasLoadedFile) && (
        <div role="alert" className="mb-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50/70 text-red-700 text-[12.5px] shrink-0">
          {error}
        </div>
      )}

      {/* 主视图卡片区 */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab !== 'advanced' && !localConfig && (
          <div className="rounded-xl border border-neutral-200/80 bg-white px-6 py-12 text-center shadow-2xs">
            <p className="mb-4 text-[13px] text-neutral-500">配置格式有效后即可使用快捷设置。</p>
            <button type="button" onClick={() => setActiveTab('advanced')} className="rounded-lg bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white shadow-xs hover:bg-neutral-800 transition-colors cursor-pointer">
              前往高级配置编辑
            </button>
          </div>
        )}

        {/* Tab 1: 基础设置（原生 macOS 风格系统偏好设置列表，无嵌套卡片） */}
        {activeTab === 'general' && localConfig && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-neutral-200/80 bg-white shadow-2xs overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-100">
              {/* 1. 模型选择 */}
              <div className="flex items-center justify-between px-6 py-3.5 hover:bg-neutral-50/40 transition-colors">
                <div className="min-w-0 flex-1 pr-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-900">模型选择</span>
                    <span className="font-mono text-[11px] text-neutral-400 bg-neutral-100 px-1.5 py-0.2 rounded">model</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 leading-normal">
                    默认会话交互与代码生成调用的主模型
                  </p>
                </div>
                <div className="shrink-0">
                  <Select
                    value={localConfig.model || ''}
                    onChange={value => {
                      const updated = { ...localConfig };
                      if (value) updated.model = value;
                      else delete updated.model;
                      setLocalConfig(updated);
                    }}
                    disabled={editingDisabled}
                    className="w-64"
                    align="right"
                    options={modelOptions}
                  />
                </div>
              </div>

              {/* 2. 思考程度 */}
              <div className="flex items-center justify-between px-6 py-3.5 hover:bg-neutral-50/40 transition-colors">
                <div className="min-w-0 flex-1 pr-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-900">思考程度</span>
                    <span className="font-mono text-[11px] text-neutral-400 bg-neutral-100 px-1.5 py-0.2 rounded">model_reasoning_effort</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 leading-normal">
                    针对具备深度思考能力的模型调节推理深度与配额预算
                  </p>
                </div>
                <div className="shrink-0">
                  <Select
                    value={localConfig.model_reasoning_effort || ''}
                    onChange={value => updateSetting('model_reasoning_effort', value)}
                    disabled={editingDisabled}
                    className="w-64"
                    align="right"
                    options={[
                      { value: '', label: '使用模型默认设置' },
                      { value: 'low', label: 'Low（轻量推理）' },
                      { value: 'medium', label: 'Medium（平衡适中）' },
                      { value: 'high', label: 'High（深度思考）' },
                      { value: 'xhigh', label: 'Extra High（极高深度）' },
                      { value: 'max', label: 'Max（最大思考配额）' },
                      { value: 'ultra', label: 'Ultra（顶格算力消耗）' }
                    ]}
                  />
                </div>
              </div>

              {/* 3. 沙盒安全模式 */}
              <div className="flex items-center justify-between px-6 py-3.5 hover:bg-neutral-50/40 transition-colors">
                <div className="min-w-0 flex-1 pr-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-900">沙盒安全模式</span>
                    <span className="font-mono text-[11px] text-neutral-400 bg-neutral-100 px-1.5 py-0.2 rounded">sandbox_mode</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 leading-normal">
                    控制代码执行环境对宿主机文件系统与网络的隔离级别
                  </p>
                </div>
                <div className="shrink-0">
                  <Select
                    value={localConfig.sandbox_mode || ''}
                    onChange={value => updateSetting('sandbox_mode', value)}
                    disabled={editingDisabled}
                    className="w-64"
                    align="right"
                    options={[
                      { value: '', label: '使用 Codex 默认设置' },
                      { value: 'read-only', label: 'Read Only（只读安全沙盒）' },
                      { value: 'workspace-write', label: 'Workspace Write（仅允许工作区写入）' },
                      { value: 'danger-full-access', label: 'Danger - Full Access（完整主机访问）' }
                    ]}
                  />
                </div>
              </div>

              {/* 4. 审批策略 */}
              <div className="flex items-center justify-between px-6 py-3.5 hover:bg-neutral-50/40 transition-colors">
                <div className="min-w-0 flex-1 pr-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-900">审批策略</span>
                    <span className="font-mono text-[11px] text-neutral-400 bg-neutral-100 px-1.5 py-0.2 rounded">approval_policy</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 leading-normal">
                    Shell 命令执行与文件写入等敏感操作的授权门禁
                  </p>
                </div>
                <div className="shrink-0">
                  <Select
                    value={typeof localConfig.approval_policy === 'object' ? '__custom__' : localConfig.approval_policy || ''}
                    onChange={value => updateSetting('approval_policy', value)}
                    disabled={editingDisabled}
                    className="w-64"
                    align="right"
                    options={[
                      { value: '', label: '使用 Codex 默认设置' },
                      ...(typeof localConfig.approval_policy === 'object' ? [{ value: '__custom__', label: '自定义细粒度审批' }] : []),
                      { value: 'untrusted', label: 'Untrusted（仅不可信操作需审批）' },
                      { value: 'on-request', label: 'On Request（模型请求时询问）' },
                      { value: 'never', label: 'Never（从不审批直接执行）' }
                    ]}
                  />
                </div>
              </div>

              {/* 5. 回复风格 */}
              <div className="flex items-center justify-between px-6 py-3.5 hover:bg-neutral-50/40 transition-colors">
                <div className="min-w-0 flex-1 pr-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-900">回复风格</span>
                    <span className="font-mono text-[11px] text-neutral-400 bg-neutral-100 px-1.5 py-0.2 rounded">personality</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 leading-normal">
                    Codex AI 回复交互时的语气习惯与沟通倾向
                  </p>
                </div>
                <div className="shrink-0">
                  <Select
                    value={localConfig.personality || ''}
                    onChange={value => updateSetting('personality', value)}
                    disabled={editingDisabled}
                    className="w-64"
                    align="right"
                    options={[
                      { value: '', label: '使用系统默认风格' },
                      { value: 'pragmatic', label: 'Pragmatic（务实精炼，聚焦代码）' },
                      { value: 'concise', label: 'Concise（极简扼要，少说多做）' },
                      { value: 'friendly', label: 'Friendly（友好详尽，亲切耐心）' },
                      { value: 'formal', label: 'Formal（严谨规范，结构完备）' }
                    ]}
                  />
                </div>
              </div>

              {/* 6. 实验性特性警告 */}
              <div className="flex items-center justify-between px-6 py-3.5 hover:bg-neutral-50/40 transition-colors">
                <div className="min-w-0 flex-1 pr-6">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-900">隐藏实验特性警告</span>
                    <span className="font-mono text-[11px] text-neutral-400 bg-neutral-100 px-1.5 py-0.2 rounded">suppress_unstable_features_warning</span>
                  </div>
                  <p className="text-[12px] text-neutral-500 leading-normal">
                    开启新特性时静默运行，不弹出不稳定功能横幅
                  </p>
                </div>
                <div className="shrink-0 flex justify-end w-64 pr-2">
                  <ToggleSwitch
                    checked={Boolean(localConfig.suppress_unstable_features_warning)}
                    label="隐藏实验特性警告"
                    disabled={editingDisabled}
                    onToggle={() => setLocalConfig({
                      ...localConfig,
                      suppress_unstable_features_warning: !localConfig.suppress_unstable_features_warning
                    })}
                  />
                </div>
              </div>
            </div>

            {/* 底部操作条 */}
            <div className="bg-neutral-50/90 border-t border-neutral-200/80 px-5 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-[12px]">
                {draft ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    存在未保存的修改（保存前预览 Diff）
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-neutral-400 text-[12px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                    已是最新配置
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {draft && (
                  <button
                    type="button"
                    onClick={discardDraft}
                    disabled={editingDisabled}
                    className="text-[12.5px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    放弃修改
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={editingDisabled || !draft || (!draft.raw && !!error)}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      <span>保存中...</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                      <span>保存修改</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: 功能开关（列表化平铺，无嵌套卡片） */}
        {activeTab === 'features' && localConfig && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-neutral-200/80 bg-white shadow-2xs overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 @min-[620px]/page:grid-cols-2 gap-x-6 gap-y-1">
                {OFFICIAL_FEATURE_KEYS.map((key) => {
                  const feature = OFFICIAL_FEATURES[key];
                  const enabled = localConfig.features?.[key] ?? feature.defaultEnabled ?? false;
                  return (
                    <div
                      key={key}
                      onClick={() => {
                        if (editingDisabled) return;
                        setLocalConfig({
                          ...localConfig,
                          features: {
                            ...(localConfig.features || {}),
                            [key]: !enabled
                          }
                        });
                      }}
                      className={cn(
                        "flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors cursor-pointer select-none border-b border-neutral-100/80",
                        enabled ? "bg-neutral-50/80 hover:bg-neutral-100/80" : "hover:bg-neutral-50/50"
                      )}
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-neutral-900 truncate">
                            {feature.label}
                          </span>
                          {feature.defaultEnabled && (
                            <span
                              title="官方默认开启：未配置时也生效"
                              className="shrink-0 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70 px-1.5 py-0.2 text-[10px] font-mono"
                            >
                              默认
                            </span>
                          )}
                        </div>
                        {feature.description && (
                          <p className="text-[11.5px] text-neutral-400 truncate mt-0.5">
                            {feature.description}
                          </p>
                        )}
                      </div>
                      <ToggleSwitch
                        checked={enabled}
                        label={feature.label}
                        onToggle={() => {}}
                        size="sm"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 底部操作条 */}
            <div className="bg-neutral-50/90 border-t border-neutral-200/80 px-5 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-[12px]">
                {draft ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    已变更开关选项（保存前预览 Diff）
                  </span>
                ) : (
                  <span className="text-neutral-400 text-[12px]">
                    共支持 {OFFICIAL_FEATURE_KEYS.length} 项官方特性开关
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {draft && (
                  <button
                    type="button"
                    onClick={discardDraft}
                    disabled={editingDisabled}
                    className="text-[12.5px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    放弃修改
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={editingDisabled || !draft || (!draft.raw && !!error)}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      <span>保存中...</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                      <span>保存修改</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: 高级配置 (TOML) */}
        {activeTab === 'advanced' && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-neutral-800 bg-[#18181B] shadow-2xs overflow-hidden">
            {/* 编辑器顶部状态栏 */}
            <div className="bg-[#1F1F23] border-b border-neutral-800 px-4 py-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]/90" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]/90" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]/90" />
                </div>
                <div className="flex items-center gap-1.5 text-neutral-300 text-[11.5px] font-mono bg-neutral-800/80 px-2.5 py-0.5 rounded border border-neutral-700/60">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span>config.toml</span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] font-mono text-neutral-500">
                  {localToml.split('\n').length} 行 · {localToml.length} 字符
                </span>
                {tomlError ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-400 bg-red-950/60 border border-red-800/60 px-2 py-0.5 rounded-full">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    语法错误
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    语法有效
                  </span>
                )}
              </div>
            </div>

            {/* 代码输入区 */}
            <textarea
              value={localToml}
              onChange={event => setLocalToml(event.target.value)}
              disabled={editingDisabled}
              aria-label="编辑 config.toml 配置"
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              className="flex-1 min-h-0 w-full bg-[#18181B] text-neutral-200 font-mono text-[12.5px] p-4 focus:outline-none resize-none leading-relaxed custom-scrollbar selectable"
              spellCheck={false}
            />

            {/* 语法错误提示 */}
            {tomlError && (
              <div role="alert" className="shrink-0 border-t border-red-900/60 bg-red-950/80 px-4 py-2 text-[12px] text-red-300 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span className="font-mono text-[11.5px]">{tomlError}</span>
              </div>
            )}

            {/* 编辑器底部操作条 */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-800 bg-[#1F1F23] px-4 py-2.5">
              <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                <span>支持快捷键</span>
                <kbd className="px-1 py-0.2 rounded bg-neutral-800 border border-neutral-700 font-mono text-[10px] text-neutral-300">⌘S</kbd>
                <span>快速保存 · 保存前预览 Diff 差异</span>
              </p>
              <div className="flex items-center gap-3">
                {draft && (
                  <button
                    type="button"
                    onClick={discardDraft}
                    disabled={editingDisabled}
                    className="text-[12px] text-neutral-400 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    放弃修改
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={editingDisabled || !draft}
                  className="rounded-lg bg-white px-4 py-1.5 text-[12.5px] font-medium text-neutral-900 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
                >
                  {isSaving ? '保存中...' : '保存配置'}
                </button>
              </div>
            </div>
          </div>
        )}
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
