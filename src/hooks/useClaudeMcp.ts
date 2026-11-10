import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type ClaudeMcpStatus = 'claudeNotFound' | 'notInstalled' | 'installed' | 'outdated';

export function useClaudeMcp() {
  const [status, setStatus] = useState<ClaudeMcpStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [showInstalledFeedback, setShowInstalledFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installing = useRef(false);

  useEffect(() => {
    let disposed = false;
    void invoke<ClaudeMcpStatus>('get_claude_mcp_status').then((value) => {
      if (!disposed) setStatus(value);
    }).catch((loadError) => {
      if (!disposed) setError(`Claude Code MCP 配置读取失败：${String(loadError)}`);
    }).finally(() => {
      if (!disposed) setIsLoading(false);
    });
    return () => { disposed = true; };
  }, []);

  const install = async () => {
    if (isLoading || installing.current || !status || status === 'claudeNotFound') return;
    installing.current = true;
    setIsInstalling(true);
    setError(null);
    try {
      await invoke('install_claude_mcp');
      setStatus(await invoke<ClaudeMcpStatus>('get_claude_mcp_status'));
      setShowInstalledFeedback(true);
    } catch (installError) {
      setError(`Claude Code MCP 安装失败：${String(installError)}`);
    } finally {
      installing.current = false;
      setIsInstalling(false);
    }
  };

  return { status, isLoading, isInstalling, showInstalledFeedback, error, install };
}
