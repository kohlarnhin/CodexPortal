import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type McpInstallStatus = 'claudeNotFound' | 'notInstalled' | 'installed' | 'outdated';
type McpChannel = 'codex' | 'claude';

export function useMcpInstall(channel: McpChannel, open: boolean) {
  const [status, setStatus] = useState<McpInstallStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installing = useRef(false);
  const canInstall = open && !isLoading && !isInstalling
    && (status === 'notInstalled' || status === 'outdated');

  useEffect(() => {
    if (!open) return;

    let disposed = false;
    setIsLoading(true);
    setStatus(null);
    setError(null);
    void invoke<McpInstallStatus>(`get_${channel}_mcp_status`).then((value) => {
      if (!disposed) setStatus(value);
    }).catch((loadError) => {
      if (!disposed) setError(String(loadError));
    }).finally(() => {
      if (!disposed) setIsLoading(false);
    });
    return () => { disposed = true; };
  }, [channel, open]);

  const install = async () => {
    if (!canInstall || installing.current) return;
    installing.current = true;
    setIsInstalling(true);
    setError(null);
    try {
      await invoke(`install_${channel}_mcp`);
      setStatus('installed');
    } catch (installError) {
      setError(String(installError));
    } finally {
      installing.current = false;
      setIsInstalling(false);
    }
  };

  return { status, isLoading, isInstalling, canInstall, error, install };
}
