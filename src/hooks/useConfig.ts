import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parse, stringify, TomlError } from 'smol-toml';
import { collectConfigDiffs, mergeConfigChanges } from '../utils/configDiff';

export interface MCPServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  disabled?: boolean;
}

export interface CodexConfig {
  sandbox_mode?: string;
  approval_policy?: string | { granular: Record<string, boolean> };
  personality?: string;
  model_reasoning_effort?: string;
  model?: string;
  suppress_unstable_features_warning?: boolean;
  features?: Record<string, boolean>;
  mcp_servers?: Record<string, MCPServer>;
  [key: string]: any;
}

export function parseConfig(content: string): CodexConfig {
  try {
    return parse(content) as CodexConfig;
  } catch (err) {
    const position = err instanceof TomlError ? `（第 ${err.line} 行，第 ${err.column} 列）` : '';
    throw new Error(`TOML 格式无效${position}，请在高级配置中修正后保存。`);
  }
}

export function useConfig(live = false) {
  const [snapshot, setSnapshot] = useState<{ config: CodexConfig | null; rawToml: string }>({ config: null, rawToml: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedFile, setHasLoadedFile] = useState(false);
  const loading = useRef(false);
  const saving = useRef(false);
  const revision = useRef(0);

  const loadConfig = useCallback(async () => {
    if (loading.current || saving.current) return;
    loading.current = true;
    const request = ++revision.current;
    setIsRefreshing(true);
    try {
      const rawToml = await invoke<string>('get_codex_config');
      if (request !== revision.current) return;
      setHasLoadedFile(true);
      try {
        const config = parseConfig(rawToml);
        setSnapshot(previous => previous.config && previous.rawToml === rawToml ? previous : { config, rawToml });
        setError(null);
      } catch (err) {
        setSnapshot({ config: null, rawToml });
        setError(String(err));
      }
    } catch (err) {
      if (request === revision.current) {
        setHasLoadedFile(false);
        setSnapshot({ config: null, rawToml: '' });
        setError(String(err));
      }
    } finally {
      loading.current = false;
      if (request === revision.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    // 只在可见页面轮询本地文件；窗口恢复焦点时立即读取。
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void loadConfig();
    };
    if (live) {
      window.addEventListener('focus', refreshVisible);
      document.addEventListener('visibilitychange', refreshVisible);
    }
    const timer = live ? window.setInterval(refreshVisible, 1500) : undefined;
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [live, loadConfig]);

  const saveConfig = async (updatedConfig: CodexConfig, baseConfig = snapshot.config) => {
    if (!baseConfig) throw new Error('请先读取有效的本地配置。');
    if (saving.current) throw new Error('正在保存配置，请稍候。');
    saving.current = true;
    ++revision.current;
    setIsRefreshing(false);
    try {
      const expectedContent = await invoke<string>('get_codex_config');
      const latest = parseConfig(expectedContent);
      const merged = mergeConfigChanges(baseConfig, updatedConfig, latest) as CodexConfig;
      const content = collectConfigDiffs(latest, merged).length === 0 ? expectedContent : stringify(merged);
      await invoke('save_codex_config', { content, expectedContent });
      setSnapshot({ config: parseConfig(content), rawToml: content });
      setHasLoadedFile(true);
      setError(null);
    } finally {
      saving.current = false;
    }
  };

  // 原文编辑按预览时的文件内容校验，直接写入用户文本，保留注释、顺序和格式。
  const saveRawConfig = async (content: string, expectedContent: string) => {
    const config = parseConfig(content);
    if (saving.current) throw new Error('正在保存配置，请稍候。');
    saving.current = true;
    ++revision.current;
    setIsRefreshing(false);
    try {
      await invoke('save_codex_config', { content, expectedContent });
      setSnapshot({ config, rawToml: content });
      setHasLoadedFile(true);
      setError(null);
    } finally {
      saving.current = false;
    }
  };

  return { ...snapshot, isLoading, isRefreshing, error, hasLoadedFile, saveConfig, saveRawConfig, refresh: loadConfig };
}
