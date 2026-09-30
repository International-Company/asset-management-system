import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PermissionKey } from '@osooli/shared';
import { clearLocalData } from '../offline/db';
import { api, ApiError, onSessionLost } from './api';

export interface Me {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: PermissionKey[];
  authProvider: 'mock' | 'eap';
  /** How the fingerprint step works: passkeys on the device, or the development code. */
  fingerprintMode?: 'code' | 'passkey';
  company: { nameAr: string; nameEn: string; logoFileId: string | null };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Why the user was signed out (shown on the login page), if any. */
  signedOutReason: string | null;
  can: (...permissions: PermissionKey[]) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * The last signed-in user, kept so the app opens offline (spec §52). It holds
 * no secrets: permissions here only shape the UI, and every request is still
 * authorized by the server when the connection is back.
 */
const ME_CACHE_KEY = 'osooli.me';

function cacheMe(me: Me | null): void {
  try {
    if (me) localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    // Storage disabled: the app just cannot open offline.
  }
}

function cachedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        const me = await api<Me>('/auth/me');
        cacheMe(me);
        return me;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'SESSION_EXPIRED')) {
          cacheMe(null);
          return null;
        }
        // No connection: continue as the last signed-in user.
        if (e instanceof ApiError && e.code === 'NETWORK_ERROR') {
          const cached = cachedMe();
          if (cached) return cached;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(
    () =>
      onSessionLost((error) => {
        // Only explain a sign-out when there was a session to lose; a first
        // visit (not yet signed in) is not an error.
        if (queryClient.getQueryData(ME_QUERY_KEY)) setSignedOutReason(error.message);
        queryClient.setQueryData(ME_QUERY_KEY, null);
        cacheMe(null);
      }),
    [queryClient],
  );

  const me = query.data ?? null;

  const can = useCallback(
    (...permissions: PermissionKey[]) => !!me && permissions.every((p) => me.permissions.includes(p)),
    [me],
  );

  const refresh = useCallback(async () => {
    setSignedOutReason(null);
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      // Update the live `me` query first (clear() would detach its observer),
      // then drop every other cached response from the signed-out user.
      queryClient.setQueryData(ME_QUERY_KEY, null);
      cacheMe(null);
      // Offline data belongs to the signed-in user (spec §53).
      await clearLocalData().catch(() => undefined);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
    }
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({ me, loading: query.isPending, signedOutReason, can, refresh, logout }),
    [me, query.isPending, signedOutReason, can, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
