import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../lib/auth';

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };

/**
 * Mocks fetch by "METHOD /path?query" (path without /api/v1). A handler registered
 * without a query string also matches any query. Unmatched calls fail the test.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const base = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/v1', '')}`;
    const key = `${base}${url.search}`;
    // JSON bodies are recorded parsed; multipart (FormData) bodies are recorded as-is.
    const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ key, body: sent });
    const handler = routes[key] ?? routes[base];
    if (!handler) throw new Error(`Unexpected API call: ${key}`);
    const { status, body } = handler(init);
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

export function renderApp(ui: ReactElement, { route = '/' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const unauthenticated = () => ({
  status: 401,
  body: { error: { code: 'UNAUTHENTICATED', message: 'يرجى تسجيل الدخول للمتابعة.' } },
});

export function meResponse(permissions: string[], roles = ['ASSET_MANAGER']) {
  return () => ({
    status: 200,
    body: {
      id: 'u1',
      username: 'manager',
      fullName: 'ليلى حسن',
      roles,
      permissions,
      authProvider: 'mock',
      company: { nameAr: 'شركة تجريبية', nameEn: 'Demo Co' },
    },
  });
}
