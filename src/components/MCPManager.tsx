import { useState, useMemo } from 'react';
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
import SegmentedControl from './SegmentedControl';
import ConfirmModal from './ConfirmModal';
import DiffModal, { DiffItem } from './DiffModal';
import SearchInput from './sessions/SearchInput';
import { Copy, Globe, PenLine, Plus, Terminal, Trash2, X } from 'lucide-react';
import { errorMessage, toast } from './ui/toast';
import PageHeader from './ui/page-header';

const isServerEnabled = (server: MCPServer) => server.enabled !== false;

const FIELDS_REJECTED_BY_STDIO = [
  'url', 'bearer_token', 'bearer_token_env_var', 'http_headers', 'env_http_headers',
  'http_headers_helper', 'oauth', 'oauth_resource', 'auth',
];
const FIELDS_REJECTED_BY_HTTP = ['command', 'args', 'env', 'env_vars', 'cwd', 'bearer_token'];

export default function MCPManager() {
  const { config, saveConfig, isLoading, error, refresh } = useConfig();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingDiffs, setPendingDiffs] = useState<DiffItem[]>([]);
  const [pendingConfig, setPendingConfig] = useState<any>(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'stdio' | 'http'>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEnv, setFormEnv] = useState<{ id: number; key: string; value: string }[]>([]);

  const servers = useMemo(() => config?.mcp_servers || {}, [config]);
  const serverKeys = useMemo(() => Object.keys(servers), [servers]);
  const serverName = formName.trim();
  const nameExists = serverName !== editingKey && Object.prototype.hasOwnProperty.call(servers, serverName);

  const activeCount = useMemo(
    () => serverKeys.filter((k) => servers[k] && isServerEnabled(servers[k])).length,
    [serverKeys, servers]
  );
  const legacyDisabledKeys = useMemo(
    () => serverKeys.filter((k) => servers[k]?.disabled === true && isServerEnabled(servers[k])),
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
      <div className="page-layout">
        <div className="page-header">
          <div className="h-6 w-28 rounded-md bg-[var(--button-fill)] animate-pulse" />
        </div>
        <div className="page-body">
          <div className="grid grid-cols-1 @min-[760px]/page:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[148px] rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-layout">
        <PageHeader title="MCP 配置" />
        <div className="page-body">
          <div className="bento-card p-5 text-body text-destructive">
            <p className="mb-1 font-semibold">加载配置失败</p>
            <p className="mb-3 text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { void refresh(); }}>
              重新读取本地配置
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleToggle = (key: string) => {
    if (!config) return;
    const currentServer = servers[key];
    const enabled = isServerEnabled(currentServer);
    const nextServer: MCPServer = { ...currentServer };
    delete nextServer.disabled;
    if (enabled) nextServer.enabled = false;
    else delete nextServer.enabled;
    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers, [key]: nextServer } };

    const diffs: DiffItem[] = [{ key: `mcp_servers.${key}.enabled`, oldVal: enabled, newVal: !enabled }];
    if (currentServer.disabled !== undefined) {
      diffs.push({ key: `mcp_servers.${key}.disabled`, oldVal: currentServer.disabled, newVal: undefined });
    }
    setPendingDiffs(diffs);
    setPendingConfig(newConfig);
    setShowDiffModal(true);
  };

  const applyLegacyDisabled = () => {
    if (!config) return;
    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers } };
    const diffs: DiffItem[] = [];
    for (const key of legacyDisabledKeys) {
      const nextServer: MCPServer = { ...servers[key], enabled: false };
      delete nextServer.disabled;
      newConfig.mcp_servers[key] = nextServer;
      diffs.push(
        { key: `mcp_servers.${key}.enabled`, oldVal: true, newVal: false },
        { key: `mcp_servers.${key}.disabled`, oldVal: true, newVal: undefined },
      );
    }
    setPendingDiffs(diffs);
    setPendingConfig(newConfig);
    setShowDiffModal(true);
  };

  const executeDelete = (key: string) => {
    if (!config) return;
    const newConfig = { ...config, mcp_servers: { ...config.mcp_servers } };
    const oldServer = newConfig.mcp_servers[key];
    delete newConfig.mcp_servers[key];

    setPendingDiffs([{ key: `mcp_servers.${key}`, oldVal: oldServer, newVal: undefined }]);
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
      setFormType('http');
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

    const sourceKey = editingKey ?? copyingKey;
    const sourceServer = sourceKey !== null ? servers[sourceKey] : undefined;
    const newServer: MCPServer = { ...sourceServer };
    if (formType === 'http') {
      if (!formUrl.trim()) return;
      FIELDS_REJECTED_BY_HTTP.forEach((field) => delete newServer[field]);
      newServer.url = formUrl.trim();
    } else {
      if (!formCommand.trim()) return;
      FIELDS_REJECTED_BY_STDIO.forEach((field) => delete newServer[field]);
      newServer.command = formCommand.trim();
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
      diffs.push({ key: `mcp_servers.${editingKey}`, oldVal: config.mcp_servers?.[editingKey], newVal: undefined });
    }
    diffs.push({ key: `mcp_servers.${serverName}`, oldVal: config.mcp_servers?.[serverName], newVal: newServer });

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
      toast.error(errorMessage(err), { title: 'MCP 配置保存失败' });
    }
  };

  return (
    <div className="page-layout">
      <PageHeader
        title="MCP 配置"
        badge={serverKeys.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground tabular-nums">
            <span className="bento-status-dot" data-tone={activeCount > 0 ? 'running' : 'idle'} aria-hidden="true" />
            {activeCount} / {serverKeys.length} 已启用
          </span>
        )}
        actions={
          <>
            {serverKeys.length > 2 && (
              <div className="w-52">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  label="搜索 MCP 服务器"
                  placeholder="搜索名称或命令…"
                />
              </div>
            )}
            <Button onClick={openAddModal} size="sm" aria-label="添加 MCP 配置">
              <Plus size={14} />
              添加
            </Button>
          </>
        }
      />

      <div className="page-scroll flex flex-col">
        {legacyDisabledKeys.length > 0 && (
          <div role="status" className="bento-card mb-3.5 flex shrink-0 items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="bento-status-dot" data-tone="warning" aria-hidden="true" />
              <p className="min-w-0 text-label leading-relaxed text-foreground">
                <span className="font-mono">{legacyDisabledKeys.join('、')}</span>
                {' '}由旧版本以 disabled 标记停用，Codex 不识别该字段，这些服务实际仍在运行。
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={applyLegacyDisabled}>
              应用停用
            </Button>
          </div>
        )}

        {serverKeys.length === 0 ? (
          <div className="bento-empty flex-1 py-16">
            <div className="mb-3.5 grid size-11 place-items-center rounded-[12px] bg-[var(--button-fill)] text-muted-foreground">
              <Globe size={20} />
            </div>
            <h3 className="mb-1 text-subtitle font-semibold text-foreground">暂无 MCP 配置</h3>
            <p className="mb-5 text-body text-muted-foreground">添加你的第一个 Model Context Protocol 服务器。</p>
            <Button size="sm" onClick={openAddModal}>
              <Plus size={14} />
              添加 MCP 服务器
            </Button>
          </div>
        ) : filteredKeys.length === 0 ? (
          <div className="bento-empty flex-1 py-12">
            <p className="mb-3 text-body text-muted-foreground">
              未找到包含 &quot;{searchQuery}&quot; 的 MCP 服务器
            </p>
            <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
              清除搜索
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 @min-[760px]/page:grid-cols-2 gap-4 pb-1">
            {filteredKeys.map((key) => {
              const server = servers[key];
              if (!server) return null;
              const isActive = isServerEnabled(server);
              const isHttp = !!server.url;
              const commandDisplay = isHttp
                ? server.url
                : [server.command, ...(server.args || [])].filter(Boolean).join(' ');
              const envCount = server.env ? Object.keys(server.env).length : 0;

              return (
                <div
                  key={key}
                  className={cn(
                    'bento-card group flex min-h-[144px] min-w-0 flex-col justify-between overflow-hidden transition-opacity',
                    !isActive && 'opacity-60 hover:opacity-85',
                  )}
                >
                  <div className="px-5 pt-5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--button-fill)] text-muted-foreground">
                          {isHttp ? <Globe size={17} /> : <Terminal size={17} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-mono text-[14.5px] font-semibold tracking-[-0.01em] text-foreground leading-tight" title={key}>
                              {key}
                            </h3>
                            <span className="shrink-0 rounded-full bg-[var(--button-fill)] px-2 py-0.5 font-mono text-caption font-medium uppercase text-muted-foreground">
                              {isHttp ? 'HTTP' : 'STDIO'}
                            </span>
                            {envCount > 0 && (
                              <span className="shrink-0 rounded-full bg-[var(--button-fill)] px-2 py-0.5 font-mono text-caption text-muted-foreground">
                                {envCount} env
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="pt-1 shrink-0">
                        <ToggleSwitch
                          label={`切换启用 ${key}`}
                          checked={isActive}
                          onToggle={() => handleToggle(key)}
                        />
                      </div>
                    </div>

                    <div className="mt-3.5 rounded-[10px] bg-muted/65 px-3 py-2 dark:bg-white/[0.04]">
                      <p className="truncate font-mono text-label text-muted-foreground select-text" title={commandDisplay}>
                        {commandDisplay}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--hairline-divider)] px-5 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                      <span
                        className="bento-status-dot"
                        data-tone={isActive ? 'running' : 'idle'}
                        aria-hidden="true"
                      />
                      {isActive ? '已启用' : '已停用'}
                    </span>

                    <div className="flex items-center gap-0.5">
                      <ActionTooltip label="编辑配置">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openServerModal(key, server, 'edit')}
                          aria-label="编辑配置"
                        >
                          <PenLine size={14} />
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip label="复制配置">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openServerModal(key, server, 'copy')}
                          aria-label={`复制 ${key} 配置`}
                        >
                          <Copy aria-hidden="true" size={14} />
                        </Button>
                      </ActionTooltip>
                      <ActionTooltip label="删除配置">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteConfirmKey(key)}
                          aria-label="删除配置"
                          className="hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </ActionTooltip>
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

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) setIsModalOpen(false);
        }}
      >
        <DialogContent className="flex max-h-[88vh] max-w-[490px] flex-col gap-4 overflow-hidden p-6">
          <DialogHeader>
            <DialogTitle>
              {editingKey ? '编辑 MCP 配置' : copyingKey ? '复制 MCP 配置' : '添加 MCP 配置'}
            </DialogTitle>
            <DialogDescription>
              {editingKey
                ? `修改 ${editingKey} 的服务协议与运行参数配置。`
                : copyingKey
                  ? `复制 ${copyingKey} 的配置，可修改后保存为新的 MCP 服务器。`
                  : '新增一个 Model Context Protocol 服务器。'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1 -mr-1">
            <div>
              <label htmlFor="mcp-server-name" className="mb-1.5 block text-label font-medium text-foreground">
                服务器名称 <span className="text-destructive">*</span>
              </label>
              <Input
                id="mcp-server-name"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如: notion, context7, apcp..."
                className="font-mono text-body"
                aria-invalid={nameExists}
                aria-describedby={nameExists ? 'mcp-server-name-error' : undefined}
              />
              {nameExists && (
                <p id="mcp-server-name-error" role="alert" className="mt-1.5 text-label text-destructive">
                  已存在同名 MCP，请使用不同的名称。
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-label font-medium text-foreground">
                通信协议
              </label>
              <SegmentedControl<'stdio' | 'http'>
                value={formType}
                onChange={setFormType}
                className="w-full [&>button]:flex-1"
                options={[
                  { id: 'stdio', label: 'STDIO (命令行进程)' },
                  { id: 'http', label: 'HTTP (远程 URL)' },
                ]}
              />
            </div>

            {formType === 'http' ? (
              <div>
                <label className="mb-1.5 block text-label font-medium text-foreground">
                  服务 URL <span className="text-destructive">*</span>
                </label>
                <Input
                  type="text"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className="font-mono text-body"
                />
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-label font-medium text-foreground">
                      执行命令 <span className="text-destructive">*</span>
                    </label>
                    <span className="text-caption text-[var(--label)]">程序可执行文件或脚本</span>
                  </div>
                  <Input
                    type="text"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    placeholder="例如: npx 或 /usr/local/bin/node"
                    className="font-mono text-body"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-label font-medium text-foreground">
                      命令参数 (Args)
                    </label>
                    <span className="text-caption text-[var(--label)]">每行一个参数</span>
                  </div>
                  <textarea
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                    placeholder="-y&#10;@upstash/context7-mcp@latest"
                    rows={3}
                    className="bento-field w-full resize-none px-3 py-2 font-mono text-body leading-relaxed placeholder:text-[var(--label)]"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <label className="text-label font-medium text-foreground">环境变量 (Env)</label>
                      {formEnv.length > 0 && (
                        <span className="font-mono text-caption text-[var(--label)]">({formEnv.length})</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormEnv([...formEnv, { id: Date.now(), key: '', value: '' }])}
                      className="bento-tag text-muted-foreground hover:text-foreground"
                    >
                      <Plus size={11} strokeWidth={2.5} />
                      添加变量
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {formEnv.length === 0 && (
                      <div className="rounded-[10px] border border-dashed border-[var(--hairline-control)] py-2.5 text-center text-label text-[var(--label)]">
                        暂无环境变量配置
                      </div>
                    )}
                    {formEnv.map((env, i) => (
                      <div
                        key={env.id}
                        className="bento-field flex items-center overflow-hidden"
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
                          className="w-2/5 bg-transparent px-2.5 py-1.5 font-mono text-label font-medium text-foreground outline-none placeholder:text-[var(--label)]"
                        />
                        <div className="h-4 w-px shrink-0 bg-[var(--hairline-divider)] select-none" />
                        <input
                          type="text"
                          value={env.value}
                          onChange={(e) => {
                            const newEnv = [...formEnv];
                            newEnv[i].value = e.target.value;
                            setFormEnv(newEnv);
                          }}
                          placeholder="VALUE"
                          className="flex-1 bg-transparent px-2.5 py-1.5 font-mono text-label text-foreground outline-none placeholder:text-[var(--label)]"
                        />
                        <button
                          type="button"
                          onClick={() => setFormEnv(formEnv.filter((_, idx) => idx !== i))}
                          className="cursor-pointer px-2.5 py-1.5 text-[var(--label)] transition-colors hover:text-destructive"
                          aria-label="删除此变量"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="mt-1 border-t border-[var(--hairline-divider)] pt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSaveModal}
              disabled={
                !serverName || nameExists ||
                (formType === 'http' ? !formUrl.trim() : !formCommand.trim())
              }
              className="min-w-[84px]"
            >
              {copyingKey ? '保存为新 MCP' : '保存配置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        onConfirm={confirmSave}
        diffs={pendingDiffs}
      />
    </div>
  );
}
