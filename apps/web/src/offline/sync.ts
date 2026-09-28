import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { applySynced, clearLocalData, getMeta, listQueue, putOp, type QueuedOp, saveSnapshot, type Snapshot } from './db';

/**
 * Offline sync engine (spec §54). Sends queued operations one at a time,
 * oldest first. Each keeps its id across retries (the server's
 * clientOperationId), so a lost response never applies an operation twice.
 * Network or server failures leave the operation PENDING for the next
 * attempt; business rejections (conflict, closed inventory, stale version…)
 * mark it NEEDS_REVIEW — the server never overwrites newer data.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
export const notifyQueueChanged = emit;

let running: Promise<SyncRun> | null = null;

export interface SyncRun {
  synced: number;
  review: number;
  stoppedBy?: 'offline' | 'session' | 'server';
}

export function processQueue(): Promise<SyncRun> {
  running ??= run().finally(() => {
    running = null;
    emit();
  });
  return running;
}

async function run(): Promise<SyncRun> {
  const result: SyncRun = { synced: 0, review: 0 };
  const ops = await listQueue();
  // An interrupted attempt (tab closed mid-request) is retried with the same id.
  for (const op of ops) if (op.status === 'SYNCING') await putOp({ ...op, status: 'PENDING' });

  for (const op of (await listQueue()).filter((o) => o.status === 'PENDING')) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return { ...result, stoppedBy: 'offline' };
    await putOp({ ...op, status: 'SYNCING' });
    emit();
    const outcome = await send(op);
    if (outcome.kind === 'retry') {
      await putOp({ ...op, status: 'PENDING', attempts: op.attempts + 1 });
      return { ...result, stoppedBy: outcome.reason };
    }
    await putOp({
      ...op,
      status: outcome.status,
      attempts: op.attempts + 1,
      errorCode: outcome.errorCode,
      message: outcome.message,
      syncedAt: outcome.status === 'SYNCED' ? new Date().toISOString() : undefined,
    });
    await applySynced(op, outcome.status, outcome.result);
    if (outcome.status === 'SYNCED') result.synced++;
    else result.review++;
    emit();
  }
  return result;
}

type SendOutcome =
  | { kind: 'done'; status: 'SYNCED' | 'NEEDS_REVIEW'; errorCode?: string; message?: string; result?: unknown }
  | { kind: 'retry'; reason: 'offline' | 'session' | 'server' };

async function send(op: QueuedOp): Promise<SendOutcome> {
  const body = new FormData();
  body.append('clientOperationId', op.id);
  body.append('clientCreatedAt', op.createdAt);
  for (const [k, v] of Object.entries(op.fields)) body.append(k, v);
  if (op.photo) body.append('photo', op.photo, op.photoName ?? 'photo.jpg');
  let res: Response;
  try {
    res = await fetch(`/api/v1/sync/operations/${op.type}`, { method: 'POST', body, credentials: 'same-origin' });
  } catch {
    return { kind: 'retry', reason: 'offline' };
  }
  if (res.status === 401) return { kind: 'retry', reason: 'session' };
  if (res.status >= 500 || res.status === 409 || res.status === 429) return { kind: 'retry', reason: 'server' };
  const json = (await res.json().catch(() => ({}))) as { status?: string; errorCode?: string; message?: string; result?: unknown; error?: { code: string; message: string } };
  if (res.ok && (json.status === 'SYNCED' || json.status === 'NEEDS_REVIEW')) {
    return { kind: 'done', status: json.status, errorCode: json.errorCode, message: json.message, result: json.result };
  }
  // A request the server refuses outright (e.g. malformed) cannot succeed by retrying.
  return { kind: 'done', status: 'NEEDS_REVIEW', errorCode: json.error?.code ?? `HTTP_${res.status}`, message: json.error?.message ?? 'رفض الخادم هذه العملية.' };
}

/** Downloads a fresh snapshot for offline use (online only). */
export async function refreshSnapshot(): Promise<Snapshot> {
  const snap = await api<Snapshot>('/sync/snapshot');
  await saveSnapshot(snap);
  emit();
  return snap;
}

/** Wipes local data when a different user signs in on this device. */
export async function ensureOwner(userId: string): Promise<void> {
  const meta = await getMeta();
  if (meta && meta.userId !== userId) {
    await clearLocalData();
    emit();
  }
}

/** Re-renders when the queue or snapshot changes. */
export function useOfflineVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/**
 * Runs the sync engine while signed in: on start, when the connection comes
 * back (automatic sync on reconnect, spec §83) and every 30 seconds.
 */
export function useAutoSync(userId: string | undefined): void {
  const trigger = useCallback(() => {
    if (navigator.onLine) void processQueue();
  }, []);
  useEffect(() => {
    if (!userId) return;
    void ensureOwner(userId).then(trigger);
    window.addEventListener('online', trigger);
    const timer = window.setInterval(trigger, 30_000);
    return () => {
      window.removeEventListener('online', trigger);
      window.clearInterval(timer);
    };
  }, [userId, trigger]);
}
