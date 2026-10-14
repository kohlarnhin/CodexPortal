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
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
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
  const serverName = formName.trim();
  const nameExists = serverName !== editingKey && Object.prototype.hasOwnProperty.call(servers, serverName);

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
        <div className="page-header">
          <div className="h-6 w-32 bg-muted rounded-md animate-pulse mb-2"></div>
          <div className="h-3.5 w-60 bg-muted rounded-md animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 @min-[1100px]/page:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-muted/50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-layout pt-4">
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-[13px] text-destructive">
          <p className="font-semibold mb-1">加载配置失败</p>
          <p className="text-muted-foreground mb-3">{error}</p>
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
    setCopyingKey(null);
    setFormName('');
    setFormType('stdio');
    setFormCommand('');
    setFormArgs('');
    setFormUrl('');
    setFormEnv([]);
    setIsModalOpen(true);
  };

  const openServerModal = (key: string, server: MCPServer, mode: 'edit' | 'copy') => {
    setEditingKey(mode === 'edit' ? key : null);
    setCopyingKey(mode === 'copy' ? key : null);
    let name = key;
    if (mode === 'copy') {
      name = `${key}_copy`;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(servers, name)) {
        name = `${key}_copy_${suffix++}`;
      }
    }
    setFormName(name);
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
    if (!serverName || nameExists || !config) return;

    // 保留认证头、超时等未在表单中展示的配置，只更新表单负责的字段。
    const sourceKey = editingKey ?? copyingKey;
    const sourceServer = sourceKey !== null ? servers[sourceKey] : undefined;
    const newServer: MCPServer = { ...sourceServer };
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
      // 未改动参数时沿用原数组，保留空参数、首尾空格和参数中的换行。
      if (!sourceServer || formArgs !== (sourceServer.args?.join('\n') ?? '')) {
        const args = formArgs
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean);
        if (args.length > 0) newServer.args = args;
        else delete newServer.args;
      }
      const envObj: Record<string, string> = {};
      formEnv.forEach((e) => {
        if (e.key.trim()) envObj[e.key.trim()] = e.value;
      });
      if (Object.keys(envObj).length > 0) newServer.env = envObj;
      else delete newServer.env;
    }

    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers } };

    if (editingKey && editingKey !== serverName) {
      delete newConfig.mcp_servers[editingKey];
    }

    newConfig.mcp_servers[serverName] = newServer;

    const diffs: DiffItem[] = [];
    if (editingKey && editingKey !== serverName) {
      diffs.push({
        key: `mcp_servers.${editingKey}`,
        oldVal: config.mcp_servers?.[editingKey],
        newVal: undefined,
      });
    }
    diffs.push({
      key: `mcp_servers.${serverName}`,
      oldVal: config.mcp_servers?.[serverName],
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
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] font-semibold leading-7 tracking-tight text-foreground">MCP 配置</h2>
            {serverKeys.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border">
                {activeCount} / {serverKeys.length} 已启用
              </span>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
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
            <Button onClick={openAddModal} size="sm" aria-label="添加 MCP 配置">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加
            </Button>
          </ActionTooltip>
        </div>
      </div>

      {/* 服务器列表 */}
      <div className="page-scroll">
        {serverKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl">
            <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mb-4 text-muted-foreground">
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
            <h3 className="text-[14.5px] font-medium text-foreground mb-1">暂无 MCP 配置</h3>
            <p className="text-[12.5px] text-muted-foreground mb-4">点击右上角按钮添加你的第一个 MCP 服务器。</p>
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
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border rounded-xl">
            <p className="text-[13px] text-muted-foreground mb-3">
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
                    'group relative min-h-[72px] min-w-0 flex gap-3 rounded-xl px-4 py-3.5 border transition-colors items-center justify-between',
                    isActive
                      ? 'bg-card shadow-xs'
                      : 'bg-muted/40 opacity-60 hover:opacity-85'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3 flex-1">
                    {/* 图标 */}
                    <div
                      className={cn(
                        'w-9 h-9 shrink-0 rounded-md flex items-center justify-center transition-colors',
                        isActive
                          ? 'bg-muted text-foreground'
                          : 'bg-muted text-muted-foreground'
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
                          className="truncate text-[13.5px] font-medium text-foreground leading-tight font-mono"
                          title={key}
                        >
                          {key}
                        </h3>
                        {isSSE ? (
                          <span className="shrink-0 px-1.5 py-px bg-background text-muted-foreground border text-[10.5px] font-mono font-medium rounded-sm uppercase">
                            SSE
                          </span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-px bg-background text-muted-foreground border text-[10.5px] font-mono font-medium rounded-sm uppercase">
                            STDIO
                          </span>
                        )}
                        {envCount > 0 && (
                          <span className="shrink-0 px-1.5 py-px bg-muted text-muted-foreground text-[10.5px] font-mono rounded-sm font-medium">
                            {envCount} env
                          </span>
                        )}
                      </div>
                      <p
                        className="text-[12px] font-mono text-muted-foreground truncate select-text"
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
                          onClick={() => openServerModal(key, server, 'edit')}
                          aria-label="编辑配置"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
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
                      <ActionTooltip label="复制配置">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openServerModal(key, server, 'copy')}
                          aria-label={`复制 ${key} 配置`}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
                        >
                          <svg
                            aria-hidden="true"
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
                            <rect x="8" y="8" width="12" height="12" rx="2" />
                            <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
                          </svg>
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip label="删除配置">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteConfirmKey(key)}
                          aria-label="删除配置"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
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
                    <div className="w-px h-4 bg-border"></div>
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

      {/* 添加 / 编辑 / 复制弹窗 */}
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) setIsModalOpen(false);
        }}
      >
        <DialogContent className="max-w-[490px] p-6 gap-4 max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {editingKey ? '编辑 MCP 配置' : copyingKey ? '复制 MCP 配置' : '添加 MCP 配置'}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              {editingKey
                ? `修改 ${editingKey} 的服务协议与运行参数配置。`
                : copyingKey
                  ? `复制 ${copyingKey} 的配置，可修改后保存为新的 MCP 服务器。`
                  : '新增一个 Model Context Protocol 服务器。'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3.5 pr-1.5 -mr-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-neutral-300">
            <div>
              <label htmlFor="mcp-server-name" className="block text-[12px] font-medium text-foreground mb-1.5">
                服务器名称 <span className="text-destructive">*</span>
              </label>
              <Input
                id="mcp-server-name"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如: notion, context7, apcp..."
                className="font-mono text-[12.5px]"
                aria-invalid={nameExists}
                aria-describedby={nameExists ? 'mcp-server-name-error' : undefined}
              />
              {nameExists && (
                <p id="mcp-server-name-error" role="alert" className="mt-1.5 text-[12px] text-destructive">
                  已存在同名 MCP，请使用不同的名称。
                </p>
              )}
            </div>

            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">
                通信协议
              </label>
              <div className="flex bg-muted p-[3px] rounded-lg">
                <button
                  type="button"
                  onClick={() => setFormType('stdio')}
                  className={cn(
                    'flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all cursor-pointer',
                    formType === 'stdio'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
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
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  SSE (HTTP URL)
                </button>
              </div>
            </div>

            {formType === 'sse' ? (
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1.5">
                  SSE URL <span className="text-destructive">*</span>
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
                    <label className="text-[12px] font-medium text-foreground">
                      执行命令 <span className="text-destructive">*</span>
                    </label>
                    <span className="text-[11px] text-muted-foreground">程序可执行文件或脚本</span>
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
                    <label className="text-[12px] font-medium text-foreground">
                      命令参数 (Args)
                    </label>
                    <span className="text-[11px] text-muted-foreground">每行一个参数</span>
                  </div>
                  <textarea
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                    placeholder="-y&#10;@upstash/context7-mcp@latest"
                    rows={3}
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-[12.5px] text-foreground focus:outline-none focus:border-neutral-700 transition-colors resize-none font-mono placeholder:text-muted-foreground shadow-xs leading-relaxed"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[12px] font-medium text-foreground">
                        环境变量 (Env)
                      </label>
                      {formEnv.length > 0 && (
                        <span className="text-[11px] font-mono text-muted-foreground">
                          ({formEnv.length})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFormEnv([...formEnv, { id: Date.now(), key: '', value: '' }])
                      }
                      className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
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
                      <div className="text-[12px] text-muted-foreground py-2.5 text-center bg-muted/40 rounded-lg border border-dashed border-border">
                        暂无环境变量配置
                      </div>
                    )}
                    {formEnv.map((env, i) => (
                      <div
                        key={env.id}
                        className="group flex items-center rounded-lg border bg-card focus-within:border-neutral-700 transition-all overflow-hidden shadow-xs"
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
                          className="w-2/5 px-2.5 py-1.5 font-mono text-[12px] bg-transparent outline-none text-foreground placeholder:text-muted-foreground font-medium"
                        />
                        <div className="h-4 w-px bg-border shrink-0 select-none" />
                        <input
                          type="text"
                          value={env.value}
                          onChange={(e) => {
                            const newEnv = [...formEnv];
                            newEnv[i].value = e.target.value;
                            setFormEnv(newEnv);
                          }}
                          placeholder="VALUE"
                          className="flex-1 px-2.5 py-1.5 font-mono text-[12px] bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                        />
                        <button
                          type="button"
                          onClick={() => setFormEnv(formEnv.filter((_, idx) => idx !== i))}
                          className="px-2.5 py-1.5 text-neutral-300 hover:text-destructive transition-colors cursor-pointer"
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

          <DialogFooter className="pt-3 border-t border-border mt-1">
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
                !serverName || nameExists ||
                (formType === 'sse' ? !formUrl.trim() : !formCommand.trim())
              }
              className="min-w-[80px]"
            >
              {copyingKey ? '保存为新 MCP' : '保存配置'}
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
