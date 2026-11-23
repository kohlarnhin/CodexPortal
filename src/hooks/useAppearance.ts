import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type Appearance = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'codex-portal.appearance';

function readSavedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Fallback to system preference when storage is unavailable.
  }
  return 'system';
}

export function useAppearance() {
  const [appearance, setAppearanceState] = useState<Appearance>(readSavedAppearance);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  const colorScheme: 'light' | 'dark' =
    appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', colorScheme === 'dark');
  }, [colorScheme]);

  useEffect(() => {
    void invoke('set_window_theme', { theme: appearance }).catch(() => {
      // Ignore in non-Tauri environments or older backends.
    });
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // In-memory fallback.
    }
  }, []);

  return { appearance, colorScheme, setAppearance };
}
