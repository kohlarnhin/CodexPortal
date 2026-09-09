import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface QuotaQuietHours {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export function useQuotaQuietHours() {
  const [saved, setSaved] = useState<QuotaQuietHours | null>(null);
  const [draft, setDraft] = useState<QuotaQuietHours | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const settings = draft ?? saved;

  const isValidTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validationError = !settings ? null
    : !isValidTime(settings.startTime) || !isValidTime(settings.endTime) ? '请填写完整的开始时间和结束时间'
    : settings.startTime === settings.endTime ? '开始时间和结束时间不能相同'
    : null;

  useEffect(() => {
    let disposed = false;
    void invoke<QuotaQuietHours>('get_quota_quiet_hours').then((value) => {
      if (!disposed) setSaved(value);
    }).catch((loadError) => {
      if (!disposed) {
        const message = `免打扰设置读取失败：${String(loadError)}`;
        setError(message);
      }
    }).finally(() => {
      if (!disposed) setIsLoading(false);
    });
    return () => {
      disposed = true;
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const triggerSavedFeedback = () => {
    setShowSavedFeedback(true);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => {
      setShowSavedFeedback(false);
    }, 2000);
  };

  const persistSettings = async (target: QuotaQuietHours) => {
    if (isSaving) return;
    if (!isValidTime(target.startTime) || !isValidTime(target.endTime) || target.startTime === target.endTime) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await invoke('set_quota_quiet_hours', { settings: target });
      setSaved(target);
      setDraft(null);
      triggerSavedFeedback();
    } catch (saveError) {
      const message = `免打扰设置保存失败：${String(saveError)}`;
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async () => {
    if (!settings || isSaving) return;
    const nextSettings = { ...settings, enabled: !settings.enabled };
    setDraft(nextSettings);
    await persistSettings(nextSettings);
  };

  const updateSettingsDraft = (changes: Partial<QuotaQuietHours>) => {
    if (!settings) return;
    setDraft((current) => ({ ...(current ?? settings), ...changes }));
    setError(null);
  };

  const commitTimeChange = async (changes: Partial<QuotaQuietHours>) => {
    if (!settings) return;
    const nextSettings = { ...settings, ...changes };
    setDraft(nextSettings);
    await persistSettings(nextSettings);
  };

  return {
    settings,
    isLoading,
    isSaving,
    showSavedFeedback,
    error,
    validationError,
    toggleEnabled,
    updateSettingsDraft,
    commitTimeChange,
  };
}

