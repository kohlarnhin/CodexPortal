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
      return result;
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
