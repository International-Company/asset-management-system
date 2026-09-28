import { ApiErrorBody, ERROR_MESSAGES, ErrorCode } from '@osooli/shared';

/** Error thrown by the API client. `message` is always Arabic and user-safe. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

type Listener = (error: ApiError) => void;
const sessionListeners = new Set<Listener>();

/** Notified when the server says the session is gone (expired or terminated). */
export function onSessionLost(listener: Listener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

const BASE = '/api/v1';

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'تعذر الاتصال بالخادم. تحقق من الاتصال بالشبكة.', 0);
  }

  if (res.ok) {
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = undefined;
  }
  const code = body?.error?.code ?? (res.status >= 500 ? 'SERVER_ERROR' : 'VALIDATION_ERROR');
  const error = new ApiError(code, body?.error?.message ?? ERROR_MESSAGES[code], res.status, body?.error?.fields);

  const isLoginCall = path.startsWith('/auth/login') || path === '/auth/config';
  if (!isLoginCall && (code === 'SESSION_EXPIRED' || code === 'UNAUTHENTICATED')) {
    sessionListeners.forEach((l) => l(error));
  }
  throw error;
}

/**
 * POSTs JSON and opens the returned file (e.g. a PDF) in a new tab. The tab is
 * opened synchronously (inside the click) so popup blockers allow it, then
 * pointed at the file once it arrives.
 */
export async function openFile(path: string, json: unknown): Promise<void> {
  const tab = window.open('', '_blank');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
  } catch {
    tab?.close();
    throw new ApiError('NETWORK_ERROR', 'تعذر الاتصال بالخادم. تحقق من الاتصال بالشبكة.', 0);
  }
  if (!res.ok) {
    tab?.close();
    const body = (await res.json().catch(() => undefined)) as Partial<ApiErrorBody> | undefined;
    const code = body?.error?.code ?? 'SERVER_ERROR';
    throw new ApiError(code, body?.error?.message ?? ERROR_MESSAGES[code], res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** URL of a stored file served by the API (photos, documents, logo). */
export const fileUrl = (fileId: string) => `${BASE}/files/${fileId}`;

/** POSTs JSON and saves the returned file with the server-provided name (report exports). */
export async function downloadFile(path: string, json: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'تعذر الاتصال بالخادم. تحقق من الاتصال بالشبكة.', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as Partial<ApiErrorBody> | undefined;
    const code = body?.error?.code ?? 'SERVER_ERROR';
    throw new ApiError(code, body?.error?.message ?? ERROR_MESSAGES[code], res.status, body?.error?.fields);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : 'report';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
