import React, { useState, useEffect } from 'react';
import { useConfig, CodexConfig } from '../hooks/useConfig';
import Select from './Select';
import DiffModal, { DiffItem } from './DiffModal';

const featureLabels: Record<string, string> = {
  collaboration_modes: "协作模式",
  multi_agent: "多智能体",
  terminal_resize_reflow: "终端自适应重排",
  js_repl: "JS 交互控制台",
  chronicle: "日志编年史",
  apps: "应用模式",
  skills: "技能系统",
  hooks: "生命周期钩子",
  goals: "目标系统",
  memories: "记忆系统",
  fast_mode: "极速模式",
  default_mode_request_user_input: "默认请求输入",
};

export default function Settings() {
  const { config, rawToml, isLoading, error, saveConfig, saveRawConfig, checkConsistency } = useConfig();
  const [activeTab, setActiveTab] = useState<'general' | 'features' | 'advanced'>('general');
  const [localConfig, setLocalConfig] = useState<CodexConfig | null>(null);
  const [localRaw, setLocalRaw] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<DiffItem[]>([]);
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [syncCheckResult, setSyncCheckResult] = useState<{ isConsistent: boolean, dbContent: string | null, localContent: string | null } | null>(null);

  useEffect(() => {
    if (config) setLocalConfig(config);
    if (rawToml) setLocalRaw(rawToml);
  }, [config, rawToml]);

  const handleSaveGeneral = () => {
    if (!localConfig || !config) return;
    
    // Compute differences
    const diffs: DiffItem[] = [];
    const keys = ['model', 'sandbox_mode', 'approval_policy', 'model_reasoning_effort'];
    keys.forEach(k => {
      if (config[k] !== localConfig[k]) {
        diffs.push({ key: k, oldVal: config[k], newVal: localConfig[k] });
      }
    });

    if (JSON.stringify(config.model_provider) !== JSON.stringify(localConfig.model_provider)) {
      diffs.push({ 
        key: 'model_provider', 
        oldVal: config.model_provider ? '第三方服务' : '官方默认服务', 
        newVal: localConfig.model_provider ? '第三方服务' : '官方默认服务' 
      });
    }

    const oldF = config.features || {};
    const newF = localConfig.features || {};
    const allFeatures = Array.from(new Set([...Object.keys(oldF), ...Object.keys(newF)]));
    allFeatures.forEach(k => {
      if (oldF[k] !== newF[k]) {
        diffs.push({ key: `features.${k}`, oldVal: oldF[k], newVal: newF[k] });
      }
    });

    if (diffs.length === 0) {
      setSaveMessage({ type: 'success', text: '无任何更改' });
      setTimeout(() => setSaveMessage(null), 2000);
      return;
    }

    setPendingDiffs(diffs);
    setShowDiffModal(true);
  };

  const confirmSave = async () => {
    if (!localConfig) return;
    try {
      setShowDiffModal(false);
      setIsSaving(true);
      setSaveMessage(null);
      await saveConfig(localConfig);
      setSaveMessage({ type: 'success', text: '保存成功' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.toString() });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRaw = async () => {
    try {
      setIsSaving(true);
      setSaveMessage(null);
      await saveRawConfig(localRaw);
      setSaveMessage({ type: 'success', text: 'TOML 保存成功' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.toString() });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckSync = async () => {
    try {
      setIsCheckingSync(true);
      const res = await checkConsistency('codex');
      if (res.is_consistent) {
        setSaveMessage({ type: 'success', text: '数据库与本机配置一致' });
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSyncCheckResult({
          isConsistent: false,
          dbContent: res.db_content,
          localContent: res.local_content
        });
      }
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: '检查同步失败: ' + err.toString() });
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setIsCheckingSync(false);
    }
  };

  const forceSync = async () => {
    if (syncCheckResult?.dbContent) {
      try {
        setIsSaving(true);
        await saveRawConfig(syncCheckResult.dbContent);
        setSyncCheckResult(null);
        setSaveMessage({ type: 'success', text: '强制同步成功' });
        setTimeout(() => setSaveMessage(null), 3000);
      } catch (err: any) {
        setSaveMessage({ type: 'error', text: '强制同步失败: ' + err.toString() });
        setTimeout(() => setSaveMessage(null), 3000);
      } finally {
        setIsSaving(false);
      }
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

  if (error && !localConfig) {
    return (
      <div className="max-w-4xl mx-auto w-full pt-10">
        <div className="bg-[#FFF0F0] border border-[#FFD0D0] text-[#D32F2F] p-5 rounded-xl flex flex-col gap-2">
          <h3 className="font-semibold text-[15px]">读取配置失败</h3>
          <p className="text-[14px]">{error}</p>
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
              onClick={handleCheckSync}
              disabled={isCheckingSync}
              className="text-[12px] px-2.5 py-1 rounded-full border border-[#EAEAEA] bg-[#F9F9F9] text-[#666666] hover:text-black hover:bg-white hover:shadow-sm transition-all flex items-center gap-1.5 font-normal disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isCheckingSync ? 'animate-spin' : ''}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              {isCheckingSync ? '检查中...' : '检查同步'}
            </button>
          </h2>
          <p className="text-[14px] text-[#666666]">可视化编辑底层 Codex 核心配置。</p>
        </div>
        {saveMessage && (
          <div className={`px-3 py-1.5 rounded-md text-[13px] font-medium animate-fade-in ${
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
            onClick={() => setActiveTab(tab.id as any)}
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

      <div className="animate-fade-in flex-1 flex flex-col min-h-0">
        {(activeTab === 'general' || activeTab === 'features') && localConfig && (
          <div className="bg-white rounded-xl border border-[#EAEAEA] flex flex-col h-full">
            <div className="p-6 flex flex-col gap-6 flex-1 overflow-y-scroll relative">
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
                        placeholder="gpt-5.6-sol"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">沙盒模式 (Sandbox Mode)</label>
                      <Select
                        value={localConfig.sandbox_mode || 'danger-full-access'}
                        onChange={value => setLocalConfig({...localConfig, sandbox_mode: value})}
                        options={[
                          { value: 'danger-full-access', label: 'Danger - Full Access' },
                          { value: 'standard', label: 'Standard' }
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">审批策略 (Approval Policy)</label>
                      <Select
                        value={localConfig.approval_policy || 'never'}
                        onChange={value => setLocalConfig({...localConfig, approval_policy: value})}
                        options={[
                          { value: 'never', label: 'Never' },
                          { value: 'always', label: 'Always' },
                          { value: 'auto', label: 'Auto' }
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[13px] font-medium text-[#444444]">思考程度 (Reasoning Effort)</label>
                      <Select
                        value={localConfig.model_reasoning_effort || 'medium'}
                        onChange={value => setLocalConfig({...localConfig, model_reasoning_effort: value})}
                        options={[
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

                  <div className="flex flex-col gap-4 pt-6 border-t border-[#EAEAEA] mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <label className="text-[14px] font-medium text-[#333333]">自定义模型服务 (Model Provider)</label>
                        <span className="text-[12px] text-[#888888] mt-0.5">
                          {!!localConfig.model_provider ? '当前正在使用第三方模型服务商' : '当前正在使用官方默认模型服务'}
                        </span>
                      </div>
                      <div 
                        onClick={() => {
                          if (localConfig.model_provider) {
                            const newConfig = { ...localConfig };
                            delete newConfig.model_provider;
                            setLocalConfig(newConfig);
                          } else {
                            setLocalConfig({
                              ...localConfig,
                              model_provider: { base_url: '', api_key: '' }
                            });
                          }
                        }}
                        className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
                          !!localConfig.model_provider ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'
                        }`}
                      >
                        <span className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
                          !!localConfig.model_provider ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </div>
                    </div>

                    {!!localConfig.model_provider && (
                      <div className="flex flex-col gap-4 bg-[#FAFAFA] p-4 rounded-lg border border-[#EAEAEA] animate-fade-in">
                        <div className="flex flex-col gap-2">
                          <label className="text-[13px] font-medium text-[#444444]">提供商名称 (Name)</label>
                          <input 
                            type="text" 
                            value={localConfig.model_provider?.name || ''}
                            onChange={e => setLocalConfig({
                              ...localConfig, 
                              model_provider: { ...localConfig.model_provider, name: e.target.value }
                            })}
                            className="px-3 py-2 bg-white border border-[#EAEAEA] rounded-md text-[14px] focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                            placeholder="如: DeepSeek"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[13px] font-medium text-[#444444]">Base URL</label>
                          <input 
                            type="text" 
                            value={localConfig.model_provider?.base_url || ''}
                            onChange={e => setLocalConfig({
                              ...localConfig, 
                              model_provider: { ...localConfig.model_provider, base_url: e.target.value }
                            })}
                            className="px-3 py-2 bg-white border border-[#EAEAEA] rounded-md text-[14px] focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                            placeholder="https://api.openai.com/v1"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[13px] font-medium text-[#444444]">API Key</label>
                          <input 
                            type="password" 
                            value={localConfig.model_provider?.api_key || ''}
                            onChange={e => setLocalConfig({
                              ...localConfig, 
                              model_provider: { ...localConfig.model_provider, api_key: e.target.value }
                            })}
                            className="px-3 py-2 bg-white border border-[#EAEAEA] rounded-md text-[14px] focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                            placeholder="sk-..."
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'features' && (
                <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                  {localConfig.features && Object.keys(localConfig.features).map((key) => (
                    <div key={key} className="flex items-center justify-between py-2 border-b border-[#F5F5F5] last:border-0">
                      <div className="flex flex-col">
                        <span className="text-[14px] text-[#333333] font-medium">{key}</span>
                        {featureLabels[key] && <span className="text-[12px] text-[#888888]">{featureLabels[key]}</span>}
                      </div>
                      <div 
                        onClick={() => {
                          setLocalConfig({
                            ...localConfig,
                            features: {
                              ...localConfig.features,
                              [key]: !localConfig.features?.[key]
                            }
                          });
                        }}
                        className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
                          localConfig.features?.[key] ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'
                        }`}
                      >
                        <span className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
                          localConfig.features?.[key] ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="bg-[#FAFAFA] border-t border-[#EAEAEA] p-4 flex justify-end mt-auto rounded-b-xl">
              <button 
                onClick={handleSaveGeneral}
                disabled={isSaving}
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
              value={localRaw}
              onChange={e => setLocalRaw(e.target.value)}
              className="flex-1 w-full bg-[#1E1E1E] text-[#D4D4D4] font-mono text-[13px] p-4 focus:outline-none resize-none leading-relaxed selectable"
              spellCheck={false}
            />
            <div className="bg-[#2D2D2D] border-t border-[#444] p-4 flex justify-end mt-auto">
              <button 
                onClick={handleSaveRaw}
                disabled={isSaving}
                title="保存 TOML"
                className="w-8 h-8 flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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
      </div>

      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        onConfirm={confirmSave}
        diffs={pendingDiffs}
      />

      {syncCheckResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-3xl overflow-hidden animate-modal-in">
            <div className="px-5 py-4 border-b border-[#EAEAEA] flex items-center justify-between bg-[#FFF9F9]">
              <h3 className="font-medium text-[15px] text-[#D32F2F] flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                配置不一致警告
              </h3>
              <button onClick={() => setSyncCheckResult(null)} className="text-[#F98A8A] hover:text-[#D32F2F] transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            
            <div className="px-5 py-4 bg-[#FAFAFA] flex flex-col gap-4">
              <p className="text-[13px] text-[#666666]">检测到数据库中的配置与本机文件 (<code>~/.codex/config.toml</code>) 不一致。</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold text-[#888] uppercase">数据库配置 (基准)</div>
                  <textarea 
                    readOnly 
                    value={syncCheckResult.dbContent || '无'} 
                    className="w-full h-[280px] bg-white border border-[#EAEAEA] rounded-md text-[12px] font-mono p-3 text-[#333] resize-none"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold text-[#888] uppercase">本机文件配置</div>
                  <textarea 
                    readOnly 
                    value={syncCheckResult.localContent || '无'} 
                    className="w-full h-[280px] bg-[#FFF9F9] border border-[#FFD0D0] rounded-md text-[12px] font-mono p-3 text-[#D32F2F] resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#EAEAEA] flex items-center justify-end gap-2 bg-white">
              <button 
                onClick={() => setSyncCheckResult(null)}
                className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F5F5F5] hover:text-black rounded-md transition-colors"
              >
                稍后处理
              </button>
              <button 
                disabled={isSaving}
                onClick={forceSync}
                className="px-4 py-1.5 bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm disabled:opacity-50"
              >
                {isSaving ? '同步中...' : '以数据库为准，强制覆盖本机'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
