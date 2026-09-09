import React, { useState, useMemo } from 'react';
import { useConfig, MCPServer } from '../hooks/useConfig';
import { cn } from '../lib/utils';
import Button from './ui/button';
import Input from './ui/input';
import { ActionTooltip } from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import ToggleSwitch from './ToggleSwitch';
import ConfirmModal from './ConfirmModal';
import DiffModal, { DiffItem } from './DiffModal';
import SearchInput from './sessions/SearchInput';

export default function MCPManager() {
  const { config, saveConfig, isLoading, error, refresh } = useConfig();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
  const [formEnv, setFormEnv] = useState<{ id: number; key: string; value: string }[]>([]);

  const servers = useMemo(() => config?.mcp_servers || {}, [config]);
  const serverKeys = useMemo(() => Object.keys(servers), [servers]);

  const activeCount = useMemo(
    () => serverKeys.filter((k) => !servers[k]?.disabled).length,
    [serverKeys, servers]
  );

  const filteredKeys = useMemo(() => {
    if (!searchQuery.trim()) return serverKeys;
    const q = searchQuery.trim().toLowerCase();
    return serverKeys.filter((key) => {
      const s = servers[key];
      if (!s) return false;
      return (
        key.toLowerCase().includes(q) ||
        (s.url && s.url.toLowerCase().includes(q)) ||
        (s.command && s.command.toLowerCase().includes(q)) ||
        (s.args && s.args.some((a) => a.toLowerCase().includes(q)))
      );
    });
  }, [serverKeys, servers, searchQuery]);

  if (isLoading) {
    return (
      <div className="page-layout pt-4">
        <div className="page-header mb-6">
          <div className="h-6 w-32 bg-[#EAEAEA] rounded animate-pulse mb-2"></div>
          <div className="h-3.5 w-60 bg-[#F0F0F0] rounded animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 @min-[1100px]/page:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-white border border-[#EAEAEA] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-layout pt-4">
        <div className="rounded-xl border border-[#F3D1D1] bg-[#FFF5F5] p-5 text-[13px] text-[#B3261E]">
          <p className="font-semibold mb-1">加载配置失败</p>
          <p className="text-[#888888] mb-3">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refresh();
            }}
          >
            重新读取本地配置
          </Button>
        </div>
      </div>
    );
  }

  const handleToggle = (key: string) => {
    if (!config) return;
    const currentServer = servers[key];
    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers } };
    newConfig.mcp_servers[key] = {
      ...currentServer,
      disabled: !currentServer.disabled,
    };

    setPendingDiffs([
      {
        key: `mcp_servers.${key}.disabled`,
        oldVal: !!currentServer.disabled,
        newVal: !currentServer.disabled,
      },
    ]);
    setPendingConfig(newConfig);
    setShowDiffModal(true);
  };

  const executeDelete = (key: string) => {
    if (!config) return;
    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers } };
    const oldServer = newConfig.mcp_servers[key];
    delete newConfig.mcp_servers[key];

    setPendingDiffs([
      {
        key: `mcp_servers.${key}`,
        oldVal: oldServer,
        newVal: undefined,
      },
    ]);
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
      const envArr = server.env
        ? Object.entries(server.env).map(([k, v], idx) => ({ id: idx, key: k, value: v }))
        : [];
      setFormEnv(envArr);
      setFormUrl('');
    }
    setIsModalOpen(true);
  };

  const handleSaveModal = async () => {
    if (!formName.trim() || !config) return;

    // 保留认证头、超时等未在表单中展示的配置，只更新表单负责的字段。
    const newServer: MCPServer = editingKey ? { ...servers[editingKey] } : {};
    if (formType === 'sse') {
      if (!formUrl.trim()) return;
      newServer.url = formUrl.trim();
      delete newServer.command;
      delete newServer.args;
      delete newServer.env;
    } else {
      if (!formCommand.trim()) return;
      delete newServer.url;
      newServer.command = formCommand.trim();
      const args = formArgs
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean);
      if (args.length > 0) newServer.args = args;
      else delete newServer.args;
      const envObj: Record<string, string> = {};
      formEnv.forEach((e) => {
        if (e.key.trim()) envObj[e.key.trim()] = e.value;
      });
      if (Object.keys(envObj).length > 0) newServer.env = envObj;
      else delete newServer.env;
    }

    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers } };

    if (editingKey && editingKey !== formName.trim()) {
      delete newConfig.mcp_servers[editingKey];
    }

    newConfig.mcp_servers[formName.trim()] = newServer;

    const diffs: DiffItem[] = [];
    if (editingKey && editingKey !== formName.trim()) {
      diffs.push({
        key: `mcp_servers.${editingKey}`,
        oldVal: config.mcp_servers?.[editingKey],
        newVal: undefined,
      });
    }
    diffs.push({
      key: `mcp_servers.${formName.trim()}`,
      oldVal: editingKey ? config.mcp_servers?.[editingKey] : undefined,
      newVal: newServer,
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
    <div className="page-layout pt-4">
      {/* 标题栏与控制区 */}
      <div className="page-header mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900">MCP 配置</h2>
            {serverKeys.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200/60">
                {activeCount} / {serverKeys.length} 已启用
              </span>
            )}
          </div>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            管理 Model Context Protocol 服务器。
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {serverKeys.length > 2 && (
            <div className="w-52">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                label="搜索 MCP 服务器"
                placeholder="搜索名称或命令..."
              />
            </div>
          )}
          <ActionTooltip label="添加 MCP 配置">
            <Button
              onClick={openAddModal}
              size="icon"
              className="h-8 w-8 shadow-sm"
              aria-label="添加 MCP 配置"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </Button>
          </ActionTooltip>
        </div>
      </div>

      {/* 服务器列表 */}
      <div className="page-scroll">
        {serverKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-[#EAEAEA] rounded-xl bg-white/60">
            <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center mb-3 text-neutral-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
            </div>
            <h3 className="text-[14.5px] font-medium text-neutral-900 mb-1">暂无 MCP 配置</h3>
            <p className="text-[12.5px] text-neutral-500 mb-4">点击右上角按钮添加你的第一个 MCP 服务器。</p>
            <Button size="sm" onClick={openAddModal} className="gap-1.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加 MCP 服务器
            </Button>
          </div>
        ) : filteredKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-[#EAEAEA] rounded-xl bg-white/50">
            <p className="text-[13px] text-neutral-500 mb-3">
              未找到包含 &quot;{searchQuery}&quot; 的 MCP 服务器
            </p>
            <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
              清除搜索
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 @min-[1100px]/page:grid-cols-2 gap-3 pb-2">
            {filteredKeys.map((key) => {
              const server = servers[key];
              if (!server) return null;
              const isActive = !server.disabled;
              const isSSE = !!server.url;
              const commandDisplay = isSSE
                ? server.url
                : [server.command, ...(server.args || [])].filter(Boolean).join(' ');
              const envCount = server.env ? Object.keys(server.env).length : 0;

              return (
                <div
                  key={key}
                  className={cn(
                    'group relative min-h-[72px] min-w-0 flex gap-3.5 rounded-xl px-4.5 py-3.5 border transition-all duration-200 items-center justify-between',
                    isActive
                      ? 'bg-white border-[#E5E5E5] hover:border-[#CCCCCC] shadow-2xs hover:shadow-xs'
                      : 'bg-[#FAFAFA]/70 border-[#EAEAEA] opacity-60 hover:opacity-85'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3 flex-1">
                    {/* 图标 */}
                    <div
                      className={cn(
                        'w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors border',
                        isActive
                          ? 'bg-neutral-100 text-neutral-800 border-neutral-200/80 group-hover:bg-neutral-150'
                          : 'bg-neutral-100/50 text-neutral-400 border-neutral-200/40'
                      )}
                    >
                      {isSSE ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                          <path d="M2 12h20" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="4 17 10 11 4 5" />
                          <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                      )}
                    </div>

                    {/* 信息区 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3
                          className="truncate text-[14px] font-semibold text-neutral-900 leading-tight font-mono"
                          title={key}
                        >
                          {key}
                        </h3>
                        {isSSE ? (
                          <span className="shrink-0 px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200/60 text-[10px] font-mono font-medium rounded-full uppercase tracking-wider">
                            SSE
                          </span>
                        ) : (
                          <span className="shrink-0 px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200/80 text-[10px] font-mono font-medium rounded-full uppercase tracking-wider">
                            STDIO
                          </span>
                        )}
                        {envCount > 0 && (
                          <span className="shrink-0 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] font-mono rounded font-medium">
                            {envCount} env
                          </span>
                        )}
                      </div>
                      <p
                        className="text-[12px] font-mono text-neutral-500 truncate select-text"
                        title={commandDisplay}
                      >
                        {commandDisplay}
                      </p>
                    </div>
                  </div>

                  {/* 操作区 */}
                  <div className="flex shrink-0 items-center gap-3 pl-2">
                    <div className="flex items-center gap-0.5">
                      <ActionTooltip label="编辑配置">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditModal(key, server)}
                          aria-label="编辑配置"
                          className="h-7 w-7 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="13.5"
                            height="13.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip label="删除配置">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteConfirmKey(key)}
                          aria-label="删除配置"
                          className="h-7 w-7 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="13.5"
                            height="13.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </Button>
                      </ActionTooltip>
                    </div>
                    <div className="w-[1px] h-4 bg-neutral-200/80"></div>
                    <div className="flex items-center">
                      <ToggleSwitch
                        label={`切换启用 ${key}`}
                        checked={isActive}
                        onToggle={() => handleToggle(key)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 确认删除弹窗 */}
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

      {/* 添加 / 编辑弹窗 */}
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) setIsModalOpen(false);
        }}
      >
        <DialogContent className="max-w-[490px] p-6 gap-4 max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold text-neutral-900">
              {editingKey ? '编辑 MCP 配置' : '添加 MCP 配置'}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-neutral-500">
              {editingKey
                ? `修改 ${editingKey} 的服务协议与运行参数配置。`
                : '新增一个 Model Context Protocol 服务器。'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3.5 pr-1.5 -mr-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-neutral-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-neutral-300">
            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">
                服务器名称 <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如: notion, context7, apcp..."
                className="font-mono text-[12.5px]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">
                通信协议
              </label>
              <div className="flex bg-neutral-100 p-0.5 rounded-lg border border-neutral-200/60">
                <button
                  type="button"
                  onClick={() => setFormType('stdio')}
                  className={cn(
                    'flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all cursor-pointer',
                    formType === 'stdio'
                      ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                      : 'text-neutral-500 hover:text-neutral-800'
                  )}
                >
                  STDIO (命令行进程)
                </button>
                <button
                  type="button"
                  onClick={() => setFormType('sse')}
                  className={cn(
                    'flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all cursor-pointer',
                    formType === 'sse'
                      ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                      : 'text-neutral-500 hover:text-neutral-800'
                  )}
                >
                  SSE (HTTP URL)
                </button>
              </div>
            </div>

            {formType === 'sse' ? (
              <div>
                <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">
                  SSE URL <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className="font-mono text-[12.5px]"
                />
              </div>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[12px] font-medium text-neutral-700">
                      执行命令 <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[11px] text-neutral-400">程序可执行文件或脚本</span>
                  </div>
                  <Input
                    type="text"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    placeholder="例如: npx 或 /usr/local/bin/node"
                    className="font-mono text-[12.5px]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[12px] font-medium text-neutral-700">
                      命令参数 (Args)
                    </label>
                    <span className="text-[11px] text-neutral-400">每行一个参数</span>
                  </div>
                  <textarea
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                    placeholder="-y&#10;@upstash/context7-mcp@latest"
                    rows={3}
                    className="w-full px-3 py-2 bg-white border border-[#E5E5E5] rounded-lg text-[12.5px] text-neutral-900 focus:outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition-all resize-none font-mono placeholder:text-neutral-400 shadow-2xs leading-relaxed"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[12px] font-medium text-neutral-700">
                        环境变量 (Env)
                      </label>
                      {formEnv.length > 0 && (
                        <span className="text-[11px] font-mono text-neutral-400">
                          ({formEnv.length})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFormEnv([...formEnv, { id: Date.now(), key: '', value: '' }])
                      }
                      className="text-[11.5px] font-medium text-neutral-600 hover:text-neutral-900 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      添加变量
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {formEnv.length === 0 && (
                      <div className="text-[12px] text-neutral-400 py-2.5 text-center bg-neutral-50/60 rounded-lg border border-dashed border-neutral-200">
                        暂无环境变量配置
                      </div>
                    )}
                    {formEnv.map((env, i) => (
                      <div
                        key={env.id}
                        className="group flex items-center rounded-lg border border-neutral-200 bg-white focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/10 transition-all overflow-hidden shadow-2xs"
                      >
                        <input
                          type="text"
                          value={env.key}
                          onChange={(e) => {
                            const newEnv = [...formEnv];
                            newEnv[i].key = e.target.value;
                            setFormEnv(newEnv);
                          }}
                          placeholder="KEY (如 API_KEY)"
                          className="w-2/5 px-2.5 py-1.5 font-mono text-[12px] bg-transparent outline-none text-neutral-900 placeholder:text-neutral-400 font-medium"
                        />
                        <div className="h-4 w-px bg-neutral-200 shrink-0 select-none" />
                        <input
                          type="text"
                          value={env.value}
                          onChange={(e) => {
                            const newEnv = [...formEnv];
                            newEnv[i].value = e.target.value;
                            setFormEnv(newEnv);
                          }}
                          placeholder="VALUE"
                          className="flex-1 px-2.5 py-1.5 font-mono text-[12px] bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400"
                        />
                        <button
                          type="button"
                          onClick={() => setFormEnv(formEnv.filter((_, idx) => idx !== i))}
                          className="px-2.5 py-1.5 text-neutral-300 hover:text-red-600 transition-colors cursor-pointer"
                          aria-label="删除此变量"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-neutral-100 mt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSaveModal}
              disabled={
                !formName.trim() ||
                (formType === 'sse' ? !formUrl.trim() : !formCommand.trim())
              }
              className="min-w-[80px]"
            >
              保存配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 变更对比确认 */}
      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        onConfirm={confirmSave}
        diffs={pendingDiffs}
      />
    </div>
  );
}
