import React, { useState } from 'react';
import { useConfig, MCPServer } from '../hooks/useConfig';
import ConfirmModal from './ConfirmModal';
import DiffModal, { DiffItem } from './DiffModal';

export default function MCPManager() {
  const { config, saveConfig, isLoading } = useConfig();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  
  // Diff Modal State
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<DiffItem[]>([]);
  const [pendingConfig, setPendingConfig] = useState<any>(null);
  
  // Form State
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'stdio' | 'sse'>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEnv, setFormEnv] = useState<{id: number, key: string, value: string}[]>([]);

  if (isLoading) return <div className="p-8 text-[#666666]">加载中...</div>;

  const servers = config?.mcp_servers || {};
  const serverKeys = Object.keys(servers);

  const handleToggle = (key: string) => {
    if (!config) return;
    const currentServer = servers[key];
    const newConfig = { ...config };
    if (!newConfig.mcp_servers) newConfig.mcp_servers = {};
    newConfig.mcp_servers[key] = {
      ...currentServer,
      disabled: !currentServer.disabled
    };
    
    setPendingDiffs([{
      key: `mcp_servers.${key}.disabled`,
      oldVal: !!currentServer.disabled,
      newVal: !currentServer.disabled
    }]);
    setPendingConfig(newConfig);
    setShowDiffModal(true);
  };

  const executeDelete = (key: string) => {
    if (!config) return;
    const newConfig = { ...config };
    if (!newConfig.mcp_servers) newConfig.mcp_servers = {};
    const oldServer = newConfig.mcp_servers[key];
    delete newConfig.mcp_servers[key];

    setPendingDiffs([{
      key: `mcp_servers.${key}`,
      oldVal: oldServer,
      newVal: undefined
    }]);
    setPendingConfig(newConfig);
    setShowDiffModal(true);
  };

  const openAddModal = () => {
    setEditingKey(null);
    setFormName('');
    setFormType('stdio');
    setFormCommand('');
    setFormArgs('');
    setFormUrl('');
    setFormEnv([]);
    setIsModalOpen(true);
  };

  const openEditModal = (key: string, server: MCPServer) => {
    setEditingKey(key);
    setFormName(key);
    if (server.url) {
      setFormType('sse');
      setFormUrl(server.url);
      setFormCommand('');
      setFormArgs('');
      setFormEnv([]);
    } else {
      setFormType('stdio');
      setFormCommand(server.command || '');
      setFormArgs(server.args ? server.args.join('\n') : '');
      const envArr = server.env ? Object.entries(server.env).map(([k, v], idx) => ({id: idx, key: k, value: v})) : [];
      setFormEnv(envArr);
      setFormUrl('');
    }
    setIsModalOpen(true);
  };

  const handleSaveModal = async () => {
    if (!formName.trim() || !config) return;
    
    const newServer: MCPServer = {};
    if (formType === 'sse') {
      if (!formUrl.trim()) return;
      newServer.url = formUrl.trim();
    } else {
      if (!formCommand.trim()) return;
      newServer.command = formCommand.trim();
      const args = formArgs.split('\n').map(a => a.trim()).filter(a => a);
      if (args.length > 0) newServer.args = args;
      const envObj: Record<string, string> = {};
      formEnv.forEach(e => {
        if (e.key.trim()) envObj[e.key.trim()] = e.value;
      });
      if (Object.keys(envObj).length > 0) newServer.env = envObj;
    }
    
    const newConfig = { ...config };
    if (!newConfig.mcp_servers) newConfig.mcp_servers = {};
    
    if (editingKey && editingKey !== formName.trim()) {
      delete newConfig.mcp_servers[editingKey];
    }
    
    if (editingKey && config.mcp_servers?.[editingKey]?.disabled !== undefined) {
      newServer.disabled = config.mcp_servers[editingKey].disabled;
    }

    newConfig.mcp_servers[formName.trim()] = newServer;
    
    const diffs: DiffItem[] = [];
    if (editingKey && editingKey !== formName.trim()) {
      diffs.push({ key: `mcp_servers.${editingKey}`, oldVal: config.mcp_servers?.[editingKey], newVal: undefined });
    }
    diffs.push({ 
      key: `mcp_servers.${formName.trim()}`, 
      oldVal: editingKey ? config.mcp_servers?.[editingKey] : undefined, 
      newVal: newServer 
    });

    setPendingDiffs(diffs);
    setPendingConfig(newConfig);
    setIsModalOpen(false);
    setShowDiffModal(true);
  };

  const confirmSave = async () => {
    if (!pendingConfig) return;
    try {
      await saveConfig(pendingConfig);
      setShowDiffModal(false);
      setPendingConfig(null);
    } catch (err: any) {
      alert(`保存失败: ${err.message || err.toString()}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full pt-4">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">MCP 配置</h2>
          <p className="text-[13px] text-[#666666]">管理 Model Context Protocol 服务器。</p>
        </div>
        <button 
          onClick={openAddModal}
          title="添加 MCP"
          className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-md hover:bg-[#333333] transition-colors shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <div className="h-[464px] overflow-y-auto pr-4 -mr-4 snap-y snap-mandatory">
        {serverKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center border-2 border-dashed border-[#EAEAEA] rounded-xl">
            <div className="w-12 h-12 bg-[#F5F5F5] rounded-full flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            </div>
            <h3 className="text-[15px] font-medium text-black mb-1">暂无 MCP 配置</h3>
            <p className="text-[13px] text-[#666666] mb-4">点击右上角按钮添加你的第一个 MCP 服务器。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {serverKeys.map((key) => {
              const server = servers[key];
              const isActive = !server.disabled;
              const isSSE = !!server.url;
              
              return (
                <div key={key} className={`h-20 flex snap-start bg-white rounded-lg px-5 border-2 items-center justify-between transition-all ${isActive ? 'border-black' : 'border-[#EAEAEA]'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-md flex items-center justify-center border ${isActive ? 'bg-black text-white border-black' : 'bg-[#F5F5F5] text-[#999999] border-[#EAEAEA]'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-[15px] font-bold text-black leading-tight">{key}</h3>
                        <span className="px-1.5 py-0.5 bg-[#F5F5F5] text-[#666666] text-[10px] font-bold rounded uppercase tracking-wider">{isSSE ? 'SSE' : 'STDIO'}</span>
                      </div>
                      <p className="text-[13px] text-[#666666] line-clamp-1 max-w-[240px]">{isSSE ? server.url : server.command}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => openEditModal(key, server)}
                        title="编辑配置"
                        className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                      <button 
                        onClick={() => setDeleteConfirmKey(key)}
                        title="删除配置"
                        className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#FFF0F0] hover:text-[#D32F2F] transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      </button>
                    </div>
                    <div className="w-[1px] h-4 bg-[#EAEAEA]"></div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleToggle(key)}
                        className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out ${
                          isActive ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'
                        }`}
                      >
                        <span className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
                          isActive ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteConfirmKey}
        title="确认删除 MCP 服务器？"
        message={`确定要删除 "${deleteConfirmKey}" 吗？此操作将从配置中移除该服务器。`}
        onConfirm={() => {
          if (deleteConfirmKey) {
            executeDelete(deleteConfirmKey);
            setDeleteConfirmKey(null);
          }
        }}
        onCancel={() => setDeleteConfirmKey(null)}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-[#EAEAEA] flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-[#EAEAEA] flex items-center justify-between bg-[#FAFAFA] shrink-0">
              <h3 className="text-[15px] font-semibold text-black">{editingKey ? '编辑 MCP 配置' : '添加 MCP 配置'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-[#999999] hover:text-black transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-[#333333] mb-1.5">名称 (标识符)</label>
                  <input 
                    type="text" 
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如: apcp"
                    className="w-full px-3 py-2 bg-white border border-[#D0D0D0] rounded-md text-[13px] text-black focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#333333] mb-1.5">通信类型</label>
                  <div className="flex bg-[#F5F5F5] p-1 rounded-md">
                    <button 
                      onClick={() => setFormType('stdio')}
                      className={`flex-1 py-1.5 text-[13px] font-medium rounded-sm transition-colors ${formType === 'stdio' ? 'bg-white text-black shadow-sm' : 'text-[#666666] hover:text-black'}`}
                    >
                      STDIO (命令行)
                    </button>
                    <button 
                      onClick={() => setFormType('sse')}
                      className={`flex-1 py-1.5 text-[13px] font-medium rounded-sm transition-colors ${formType === 'sse' ? 'bg-white text-black shadow-sm' : 'text-[#666666] hover:text-black'}`}
                    >
                      SSE (HTTP URL)
                    </button>
                  </div>
                </div>

                {formType === 'sse' ? (
                  <div>
                    <label className="block text-[13px] font-medium text-[#333333] mb-1.5">SSE URL</label>
                    <input 
                      type="text" 
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      placeholder="https://example.com/mcp"
                      className="w-full px-3 py-2 bg-white border border-[#D0D0D0] rounded-md text-[13px] text-black focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-[#333333] mb-1.5">执行命令 (Command)</label>
                      <input 
                        type="text" 
                        value={formCommand}
                        onChange={(e) => setFormCommand(e.target.value)}
                        placeholder="例如: npx 或 /usr/local/bin/node"
                        className="w-full px-3 py-2 bg-white border border-[#D0D0D0] rounded-md text-[13px] text-black focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#333333] mb-1.5">参数 (Args - 每行一个)</label>
                      <textarea 
                        value={formArgs}
                        onChange={(e) => setFormArgs(e.target.value)}
                        placeholder="-y&#10;@upstash/context7-mcp@latest"
                        rows={3}
                        className="w-full px-3 py-2 bg-white border border-[#D0D0D0] rounded-md text-[13px] text-black focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors resize-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="flex items-center justify-between text-[13px] font-medium text-[#333333] mb-1.5">
                        环境变量 (Env)
                        <button 
                          onClick={() => setFormEnv([...formEnv, {id: Date.now(), key: '', value: ''}])}
                          className="text-[#0066CC] hover:text-[#004499] text-[12px] flex items-center gap-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          添加
                        </button>
                      </label>
                      <div className="space-y-2">
                        {formEnv.length === 0 && <div className="text-[12px] text-[#999999] py-2 text-center bg-[#F9F9F9] rounded border border-dashed border-[#EAEAEA]">无环境变量</div>}
                        {formEnv.map((env, i) => (
                          <div key={env.id} className="flex items-center gap-2">
                            <input 
                              type="text" 
                              value={env.key}
                              onChange={(e) => {
                                const newEnv = [...formEnv];
                                newEnv[i].key = e.target.value;
                                setFormEnv(newEnv);
                              }}
                              placeholder="KEY"
                              className="w-1/3 px-2 py-1.5 bg-white border border-[#D0D0D0] rounded text-[12px] font-mono focus:outline-none focus:border-black"
                            />
                            <span className="text-[#999999]">=</span>
                            <input 
                              type="text" 
                              value={env.value}
                              onChange={(e) => {
                                const newEnv = [...formEnv];
                                newEnv[i].value = e.target.value;
                                setFormEnv(newEnv);
                              }}
                              placeholder="value"
                              className="flex-1 px-2 py-1.5 bg-white border border-[#D0D0D0] rounded text-[12px] font-mono focus:outline-none focus:border-black"
                            />
                            <button 
                              onClick={() => setFormEnv(formEnv.filter((_, idx) => idx !== i))}
                              className="text-[#999999] hover:text-[#D32F2F]"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#EAEAEA] bg-[#FAFAFA] flex justify-end gap-3 shrink-0">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-[13px] font-medium text-[#666666] hover:text-black bg-white border border-[#D0D0D0] rounded-md transition-colors"
              >
                取消
              </button>
              <button 
                onClick={handleSaveModal}
                disabled={!formName.trim() || (formType === 'sse' ? !formUrl.trim() : !formCommand.trim())}
                className="px-5 py-2 text-[13px] font-medium text-white bg-black hover:bg-black/80 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}


      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        onConfirm={confirmSave}
        diffs={pendingDiffs}
      />
    </div>
  );
}
