import React, { useState } from 'react';
import { useConfig, parseConfig, CodexConfig } from '../hooks/useConfig';
import { stringify } from 'smol-toml';
import Select from './Select';
import DiffModal, { DiffItem } from './DiffModal';
import { OFFICIAL_FEATURES, OFFICIAL_FEATURE_KEYS } from '../utils/codexFeatures';
import { collectConfigDiffs } from '../utils/configDiff';
import { PRICED_MODELS } from '../utils/modelPricing';

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

  const updateSetting = (key: 'sandbox_mode' | 'approval_policy' | 'model_reasoning_effort', value: string) => {
    if (!localConfig || value === '__custom__') return;
    const updated = { ...localConfig };
    if (value) updated[key] = value;
    else delete updated[key];
    setLocalConfig(updated);
  };

  const handleSave = () => {
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
  };

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
      <div className="max-w-4xl mx-auto w-full pt-10">
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-8 bg-[#F0F0F0] rounded w-1/4 mb-4"></div>
          <div className="h-32 bg-[#F0F0F0] rounded-xl w-full"></div>
          <div className="h-32 bg-[#F0F0F0] rounded-xl w-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-6 shrink-0 relative z-10">
        <div>
          <h2 className="text-[20px] font-semibold text-black tracking-tight mb-1.5 flex items-center gap-3">
            配置管理
            <button 
              onClick={() => { void refresh(); }}
              disabled={isRefreshing || isSaving || showDiffModal}
              className="text-[12px] px-2.5 py-1 rounded-full border border-[#EAEAEA] bg-[#F9F9F9] text-[#666666] hover:text-black hover:bg-white hover:shadow-sm transition-all flex items-center gap-1.5 font-normal disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRefreshing ? 'animate-spin' : ''}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              {isRefreshing ? '读取中...' : '刷新'}
            </button>
          </h2>
          <p className="text-[14px] text-[#666666]">仅支持 OpenAI 官方订阅，配置修改后保存到本地 config.toml。</p>
        </div>
        {saveMessage && (
          <div role={saveMessage.type === 'error' ? 'alert' : 'status'} className={`max-w-sm break-words px-3 py-1.5 rounded-md text-[13px] font-medium animate-fade-in ${
            saveMessage.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-[#FFF0F0] text-[#D32F2F] border border-[#FFD0D0]'
          }`}>
            {saveMessage.text}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 border-b border-[#EAEAEA] mb-6 shrink-0">
        {[
          { id: 'general', label: '基础设置' },
          { id: 'features', label: '功能开关' },
          { id: 'advanced', label: '高级配置 (TOML)' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id as typeof activeTab); void refresh(); }}
            disabled={isSaving || showDiffModal}
            className={`pb-3 text-[14px] font-medium transition-colors relative ${
              activeTab === tab.id ? 'text-black' : 'text-[#888888] hover:text-black'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-black rounded-t-full"></div>
            )}
          </button>
        ))}
      </div>

      {error && (!draft?.raw || !hasLoadedFile) && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-md border border-[#FFD0D0] bg-[#FFF0F0] text-[#D32F2F] text-[13px]">
          {error}
        </div>
      )}
      <div className="animate-fade-in flex-1 flex flex-col min-h-0">
        {activeTab !== 'advanced' && !localConfig && (
          <div className="rounded-xl border border-[#EAEAEA] bg-white px-6 py-8 text-center">
            <p className="mb-4 text-[13px] text-[#777777]">配置格式有效后即可使用快捷设置。</p>
            <button type="button" onClick={() => setActiveTab('advanced')} className="rounded-md bg-black px-4 py-2 text-[13px] text-white">前往高级配置编辑</button>
          </div>
        )}
        {(activeTab === 'general' || activeTab === 'features') && localConfig && (
          <div className="bg-white rounded-xl border border-[#EAEAEA] flex flex-col h-full">
            <fieldset disabled={editingDisabled || (!draft?.raw && !!error)} className="p-6 flex flex-col gap-6 flex-1 min-h-0 overflow-y-scroll relative">
              {activeTab === 'general' && (
                <>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">模型 (Model)</label>
                      <input 
                        type="text" 
                        value={localConfig.model || ''}
                        onChange={e => setLocalConfig({...localConfig, model: e.target.value})}
                        className="px-3 py-2 bg-[#FAFAFA] border border-[#EAEAEA] rounded-md text-[14px] focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                        placeholder="gpt-6-astra"
                        list="codex-models"
                      />
                      <datalist id="codex-models">
                        {PRICED_MODELS.map(model => <option key={model} value={model} />)}
                      </datalist>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">沙盒模式 (Sandbox Mode)</label>
                      <Select
                        value={localConfig.sandbox_mode || ''}
                        onChange={value => updateSetting('sandbox_mode', value)}
                        options={[
                          { value: '', label: '使用 Codex 默认设置' },
                          { value: 'read-only', label: 'Read Only' },
                          { value: 'workspace-write', label: 'Workspace Write' },
                          { value: 'danger-full-access', label: 'Danger - Full Access' }
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">审批策略 (Approval Policy)</label>
                      <Select
                        value={typeof localConfig.approval_policy === 'object' ? '__custom__' : localConfig.approval_policy || ''}
                        onChange={value => updateSetting('approval_policy', value)}
                        options={[
                          { value: '', label: '使用 Codex 默认设置' },
                          ...(typeof localConfig.approval_policy === 'object' ? [{ value: '__custom__', label: '自定义细粒度审批' }] : []),
                          { value: 'untrusted', label: 'Untrusted' },
                          { value: 'on-request', label: 'On Request' },
                          { value: 'never', label: 'Never' }
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">思考程度 (Reasoning Effort)</label>
                      <Select
                        value={localConfig.model_reasoning_effort || ''}
                        onChange={value => updateSetting('model_reasoning_effort', value)}
                        options={[
                          { value: '', label: '使用模型默认设置' },
                          { value: 'low', label: 'Low' },
                          { value: 'medium', label: 'Medium' },
                          { value: 'high', label: 'High' },
                          { value: 'xhigh', label: 'Extra High' },
                          { value: 'max', label: 'Max' },
                          { value: 'ultra', label: 'Ultra' }
                        ]}
                      />
                    </div>
                  </div>

                </>
              )}

              {activeTab === 'features' && (
                <div className="grid grid-cols-2 gap-x-12 gap-y-1">
                  {/* 官方支持的全部开关：未配置时展示官方默认值，保存只写入实际修改 */}
                  {OFFICIAL_FEATURE_KEYS.map((key) => {
                    const feature = OFFICIAL_FEATURES[key];
                    const enabled = localConfig.features?.[key] ?? feature.defaultEnabled ?? false;
                    return (
                      <div key={key} className="flex items-center justify-between py-2 border-b border-[#F5F5F5] last:border-0">
                        <div className="flex flex-col min-w-0 pr-3">
                          <span className="flex items-center gap-2 text-[14px] text-[#333333] font-medium truncate">
                            {feature.label}
                            {feature.defaultEnabled && (
                              <span
                                title="官方默认开启：不配置也生效，无需手动打开"
                                className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-px text-[10px] font-medium text-emerald-600"
                              >
                                默认开启
                              </span>
                            )}
                          </span>
                          {feature.description && (
                            <span className="text-[12px] text-[#888888] mt-0.5">{feature.description}</span>
                          )}
                        </div>
                        <div
                          onClick={() => {
                            setLocalConfig({
                              ...localConfig,
                              features: {
                                ...(localConfig.features || {}),
                                [key]: !enabled
                              }
                            });
                          }}
                          className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ${
                            enabled ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'
                          }`}
                        >
                          <span className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="bg-[#FAFAFA] border-t border-[#EAEAEA] p-4 flex items-center justify-end gap-3 mt-auto rounded-b-xl">
              {draft && (
                <button onClick={discardDraft} disabled={editingDisabled} className="text-[13px] text-[#666666] hover:text-black disabled:opacity-50">
                  放弃修改并重新载入
                </button>
              )}
              <button 
                onClick={handleSave}
                disabled={editingDisabled || !draft || (!draft.raw && !!error)}
                title="保存修改"
                className="w-8 h-8 flex items-center justify-center bg-black hover:bg-[#333333] text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isSaving ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                )}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="bg-[#1E1E1E] rounded-xl border border-[#333] overflow-hidden shadow-sm flex flex-col h-full">
            <div className="bg-[#2D2D2D] border-b border-[#444] px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-[#A0A0A0] text-[12px] font-mono">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                ~/.codex/config.toml
              </div>
            </div>
            <textarea 
              value={localToml}
              onChange={event => setLocalToml(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  handleSave();
                }
              }}
              disabled={editingDisabled}
              aria-label="编辑 config.toml 配置"
              aria-describedby={tomlError ? 'toml-error' : 'toml-editor-hint'}
              aria-invalid={!!tomlError}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              className="flex-1 min-h-0 w-full bg-[#1E1E1E] text-[#D4D4D4] font-mono text-[13px] p-4 focus:outline-none resize-none leading-relaxed selectable"
              spellCheck={false}
            />
            {tomlError && (
              <div id="toml-error" role="alert" className="shrink-0 border-t border-[#704343] bg-[#382323] px-4 py-2.5 text-[12px] text-[#FFB4B4]">
                {tomlError}
              </div>
            )}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#444] bg-[#2D2D2D] px-4 py-3">
              <p id="toml-editor-hint" className="text-[11px] text-[#A0A0A0]">可编辑完整 TOML · 保存前预览差异{draft ? ' · 有未保存修改' : ''}</p>
              <div className="flex items-center gap-3">
                {draft && (
                  <button type="button" onClick={discardDraft} disabled={editingDisabled} className="text-[12px] text-[#BBBBBB] hover:text-white disabled:opacity-50">
                    放弃修改并重新载入
                  </button>
                )}
                <button type="button" onClick={handleSave} disabled={editingDisabled || !draft} className="rounded-md bg-white px-4 py-1.5 text-[12px] font-medium text-[#222222] transition-colors hover:bg-[#EAEAEA] disabled:cursor-not-allowed disabled:opacity-40">
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
