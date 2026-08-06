import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parse, stringify } from 'smol-toml';

export interface MCPServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  disabled?: boolean;
}

export interface ModelProvider {
  base_url?: string;
  api_key?: string;
  [key: string]: any;
}

export interface CodexConfig {
  sandbox_mode?: string;
  approval_policy?: string;
  personality?: string;
  model_reasoning_effort?: string;
  model?: string;
  suppress_unstable_features_warning?: boolean;
  features?: Record<string, boolean>;
  mcp_servers?: Record<string, MCPServer>;
  model_provider?: ModelProvider;
  [key: string]: any;
}

export interface ConsistencyCheckResult {
  is_consistent: boolean;
  db_content: string | null;
  local_content: string | null;
}

const IGNORED_CODEX_SYNC_ROOT_KEYS = new Set(['projects']);

function normalizeConfigValue(value: unknown, isRoot = false): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeConfigValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter(key => !isRoot || !IGNORED_CODEX_SYNC_ROOT_KEYS.has(key))
      .sort();

    return Object.fromEntries(
      keys.map(key => [key, normalizeConfigValue(record[key])])
    );
  }

  return value;
}

function normalizeConfigText(content: string) {
  return content.replace(/\r\n?/g, '\n').trimEnd();
}

function areCodexConfigsEquivalent(dbContent: string | null, localContent: string | null) {
  if (dbContent === localContent) return true;
  if (dbContent === null || localContent === null) return false;

  try {
    const dbConfig = normalizeConfigValue(parse(dbContent), true);
    const localConfig = normalizeConfigValue(parse(localContent), true);
    return JSON.stringify(dbConfig) === JSON.stringify(localConfig);
  } catch {
    return normalizeConfigText(dbContent) === normalizeConfigText(localContent);
  }
}

export function useConfig() {
  const [config, setConfig] = useState<CodexConfig | null>(null);
  const [rawToml, setRawToml] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const tomlString = await invoke<string>('get_codex_config');
      setRawToml(tomlString);
      
      try {
        const parsed = parse(tomlString) as CodexConfig;
        setConfig(parsed);
      } catch (parseErr) {
        console.error('Failed to parse TOML:', parseErr);
      }
    } catch (err: any) {
      console.error('Failed to load config:', err);
      setError(err?.toString() || 'Failed to load config.toml');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const saveConfig = async (updatedConfig: CodexConfig) => {
    try {
      const tomlString = stringify(updatedConfig);
      await invoke('save_codex_config', { content: tomlString });
      setRawToml(tomlString);
      setConfig(updatedConfig);
    } catch (err: any) {
      console.error('Failed to save config:', err);
      throw err;
    }
  };

  const saveRawConfig = async (tomlString: string) => {
    try {
      // Validate TOML first
      const parsed = parse(tomlString) as CodexConfig;
      await invoke('save_codex_config', { content: tomlString });
      setRawToml(tomlString);
      setConfig(parsed);
    } catch (err: any) {
      console.error('Failed to save raw config:', err);
      throw err;
    }
  };

  const checkConsistency = async (configType: 'codex' | 'mcp' = 'codex'): Promise<ConsistencyCheckResult> => {
    try {
      const result = await invoke<ConsistencyCheckResult>('check_config_consistency', { configType });
      if (configType !== 'codex') return result;

      return {
        ...result,
        is_consistent: areCodexConfigsEquivalent(result.db_content, result.local_content),
      };
    } catch (err: any) {
      console.error('Failed to check consistency:', err);
      throw err;
    }
  };

  return {
    config,
    rawToml,
    isLoading,
    error,
    saveConfig,
    saveRawConfig,
    checkConsistency,
    refresh: loadConfig
  };
}
