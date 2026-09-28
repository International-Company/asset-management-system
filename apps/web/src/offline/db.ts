import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { AssetStatus } from '@osooli/shared';

/**
 * Local offline storage (spec §52–53). Holds a limited, non-sensitive
 * snapshot for lookup and counting, and the queue of offline operations.
 * It belongs to one signed-in user and is wiped on logout or on request.
 */

export interface LocalAsset {
  id: string;
  assetNumber: string;
  name: string;
  qrToken: string;
  serialNumber: string;
  status: AssetStatus;
  version: number;
  notes: string | null;
  locationId: string;
  location: string;
  departmentId: string;
  department: string;
  responsible: string | null;
}

export interface LocalInventoryItem {
  id: string;
  assetId: string;
  assetNumber: string;
  name: string;
  qrToken: string;
  serialNumber: string;
  expectedStatus: AssetStatus;
  expectedLocationId: string;
  expectedDepartmentId: string;
  expectedPlace: string;
  /** Server check time when the snapshot was taken — the base for conflict detection. */
  checkedAt: string | null;
  exists: boolean | null;
  /** Result recorded on this device and not yet synced. */
  localCheck?: { exists: boolean; at: string };
}

export interface LocalInventory {
  id: string;
  number: string;
  scope: string;
  items: LocalInventoryItem[];
}

export interface LocalLocation {
  id: string;
  name: string;
  departments: Array<{ id: string; name: string }>;
}

export interface Snapshot {
  generatedAt: string;
  userId: string;
  truncated: boolean;
  assets: LocalAsset[];
  locations: LocalLocation[];
  inventories: LocalInventory[];
}

export type OpStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'NEEDS_REVIEW';
export type OpType = 'inventory.check' | 'inventory.unregistered' | 'asset.photo' | 'asset.notes';

export interface QueuedOp {
  /** Also the server-side clientOperationId: retries reuse it, so nothing is applied twice. */
  id: string;
  type: OpType;
  fields: Record<string, string>;
  photo?: Blob;
  photoName?: string;
  /** Human-readable description, e.g. "فحص TEC-000010 — INV-000003". */
  label: string;
  status: OpStatus;
  createdAt: string;
  attempts: number;
  errorCode?: string;
  message?: string;
  syncedAt?: string;
  /** Groups ops that target the same record (a re-check replaces a pending check). */
  target?: string;
}

export interface Meta {
  userId: string;
  generatedAt: string;
  truncated: boolean;
  locations: LocalLocation[];
}

interface OfflineDB extends DBSchema {
  meta: { key: 'snapshot'; value: Meta };
  assets: { key: string; value: LocalAsset; indexes: { qrToken: string; assetNumber: string; serialNumber: string } };
  inventories: { key: string; value: LocalInventory };
  queue: { key: string; value: QueuedOp; indexes: { status: OpStatus; target: string } };
}

const DB_NAME = 'osooli-offline';
let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function db(): Promise<IDBPDatabase<OfflineDB>> {
  dbPromise ??= openDB<OfflineDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('meta');
      const assets = d.createObjectStore('assets', { keyPath: 'id' });
      assets.createIndex('qrToken', 'qrToken', { unique: true });
      assets.createIndex('assetNumber', 'assetNumber');
      assets.createIndex('serialNumber', 'serialNumber');
      d.createObjectStore('inventories', { keyPath: 'id' });
      const queue = d.createObjectStore('queue', { keyPath: 'id' });
      queue.createIndex('status', 'status');
      queue.createIndex('target', 'target');
    },
  });
  return dbPromise;
}

/** Replaces the cached snapshot. Queued operations are kept. */
export async function saveSnapshot(s: Snapshot): Promise<void> {
  const d = await db();
  const pendingByItem = new Map<string, LocalInventoryItem['localCheck']>();
  for (const inv of await d.getAll('inventories')) for (const i of inv.items) if (i.localCheck) pendingByItem.set(i.id, i.localCheck);
  const tx = d.transaction(['meta', 'assets', 'inventories'], 'readwrite');
  await Promise.all([tx.objectStore('assets').clear(), tx.objectStore('inventories').clear()]);
  for (const a of s.assets) void tx.objectStore('assets').put(a);
  for (const inv of s.inventories) {
    // Keep unsynced local results visible after a refresh.
    void tx.objectStore('inventories').put({ ...inv, items: inv.items.map((i) => (pendingByItem.has(i.id) ? { ...i, localCheck: pendingByItem.get(i.id) } : i)) });
  }
  void tx.objectStore('meta').put({ userId: s.userId, generatedAt: s.generatedAt, truncated: s.truncated, locations: s.locations }, 'snapshot');
  await tx.done;
}

export async function getMeta(): Promise<Meta | undefined> {
  return (await db()).get('meta', 'snapshot');
}

/** Extracts the QR token from a scanned "/qr/{token}" URL; other codes are returned as-is. */
export function codeToToken(code: string): string {
  const i = code.lastIndexOf('/qr/');
  return i >= 0 ? code.slice(i + 4).split(/[?#/]/)[0] : code.trim();
}

/** Finds a cached asset by QR (URL or token), asset number or serial number. */
export async function findAsset(code: string): Promise<LocalAsset | undefined> {
  const d = await db();
  const token = codeToToken(code);
  return (
    (await d.getFromIndex('assets', 'qrToken', token)) ??
    (await d.getFromIndex('assets', 'assetNumber', code.trim().toUpperCase())) ??
    (await d.getFromIndex('assets', 'serialNumber', code.trim()))
  );
}

export async function countAssets(): Promise<number> {
  return (await db()).count('assets');
}

export async function listInventories(): Promise<LocalInventory[]> {
  return (await db()).getAll('inventories');
}

export async function getInventory(id: string): Promise<LocalInventory | undefined> {
  return (await db()).get('inventories', id);
}

export async function markItemChecked(inventoryId: string, itemId: string, exists: boolean): Promise<void> {
  const d = await db();
  const inv = await d.get('inventories', inventoryId);
  if (!inv) return;
  inv.items = inv.items.map((i) => (i.id === itemId ? { ...i, localCheck: { exists, at: new Date().toISOString() } } : i));
  await d.put('inventories', inv);
}

export async function updateLocalAsset(id: string, patch: Partial<LocalAsset>): Promise<void> {
  const d = await db();
  const a = await d.get('assets', id);
  if (a) await d.put('assets', { ...a, ...patch });
}

// ── Queue ───────────────────────────────────────────────────────────────

export async function listQueue(): Promise<QueuedOp[]> {
  const ops = await (await db()).getAll('queue');
  return ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Adds an operation. A still-pending operation for the same target (e.g. a
 * re-check of the same inventory item) is replaced, so both never reach the
 * server with the same base — which would make the second one a false conflict.
 */
export async function enqueue(op: Omit<QueuedOp, 'id' | 'status' | 'createdAt' | 'attempts'>): Promise<QueuedOp> {
  const d = await db();
  if (op.target) {
    for (const existing of await d.getAllFromIndex('queue', 'target', op.target)) {
      if (existing.status === 'PENDING') await d.delete('queue', existing.id);
    }
  }
  const full: QueuedOp = { ...op, id: crypto.randomUUID(), status: 'PENDING', createdAt: new Date().toISOString(), attempts: 0 };
  await d.put('queue', full);
  return full;
}

export async function putOp(op: QueuedOp): Promise<void> {
  await (await db()).put('queue', op);
}

/**
 * Brings the local snapshot in line with a finished operation, so a later
 * offline operation on the same record is based on the new server state
 * (e.g. a re-check after a synced check is not a false conflict).
 */
export async function applySynced(op: QueuedOp, status: 'SYNCED' | 'NEEDS_REVIEW', result: unknown): Promise<void> {
  const r = (result ?? {}) as { checkedAt?: string; version?: number };
  const d = await db();
  if (op.type === 'inventory.check') {
    const inv = await d.get('inventories', op.fields.inventoryId);
    if (!inv) return;
    inv.items = inv.items.map((i) => {
      if (i.id !== op.fields.itemId) return i;
      const { localCheck: _drop, ...rest } = i;
      return status === 'SYNCED' ? { ...rest, checkedAt: r.checkedAt ?? i.checkedAt, exists: op.fields.exists === 'true' } : rest;
    });
    await d.put('inventories', inv);
  } else if (op.type === 'asset.notes' && status === 'SYNCED' && typeof r.version === 'number') {
    await updateLocalAsset(op.fields.assetId, { version: r.version, notes: op.fields.notes || null });
  }
}

export async function removeOp(id: string): Promise<void> {
  await (await db()).delete('queue', id);
}

/** "Clear Local Data" (spec §53): removes the snapshot and the whole queue. */
export async function clearLocalData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'assets', 'inventories', 'queue'], 'readwrite');
  await Promise.all(['meta', 'assets', 'inventories', 'queue'].map((s) => tx.objectStore(s as 'meta').clear()));
  await tx.done;
}
