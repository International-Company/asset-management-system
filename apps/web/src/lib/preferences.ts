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

/**
 * Which sidebar groups are open, remembered per device. A group with no
 * saved choice follows `fallback` (open when it holds the current page).
 */
export function useNavGroups(): [(title: string, fallback: boolean) => boolean, (title: string, open: boolean) => void] {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try {
      const parsed = JSON.parse(read('osooli.navGroups') ?? '{}') as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const isOpen = useCallback((title: string, fallback: boolean) => state[title] ?? fallback, [state]);
  const setOpen = useCallback((title: string, open: boolean) => {
    setState((prev) => {
      if (prev[title] === open) return prev;
      const next = { ...prev, [title]: open };
      write('osooli.navGroups', JSON.stringify(next));
      return next;
    });
  }, []);
  return [isOpen, setOpen];
}

/** Whether a media query matches, kept in sync with the window. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
