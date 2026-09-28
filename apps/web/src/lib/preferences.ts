import { useCallback, useEffect, useState } from 'react';

/** Per-device UI preferences (sidebar, theme). Storage failures are ignored. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or storage disabled: keep the in-memory value only.
  }
}

export function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => read('osooli.sidebarCollapsed') === 'true');
  const set = useCallback((v: boolean) => {
    setCollapsed(v);
    write('osooli.sidebarCollapsed', String(v));
  }, []);
  return [collapsed, set];
}

export type Theme = 'light' | 'dark';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = read('osooli.theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const set = useCallback((t: Theme) => {
    setTheme(t);
    write('osooli.theme', t);
  }, []);
  return [theme, set];
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
