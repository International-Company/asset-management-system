import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ASSET_STATUS_LABELS, type AssetStatus, PERMISSIONS } from '@osooli/shared';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/preferences';
import { SelectField, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { QrScanner } from '../../components/QrScanner';
import { Empty, Loading } from '../../components/States';
import { CHECK_STATUSES } from '../inventory/InventoryPages';
import {
  clearLocalData,
  codeToToken,
  countAssets,
  enqueue,
  findAsset,
  getInventory,
  getMeta,
  listInventories,
  listQueue,
  type LocalAsset,
  type LocalInventory,
  type LocalInventoryItem,
  markItemChecked,
  type Meta,
  type OpStatus,
  type QueuedOp,
  removeOp,
  updateLocalAsset,
} from '../../offline/db';
import { notifyQueueChanged, processQueue, refreshSnapshot, type SyncRun, useOfflineVersion } from '../../offline/sync';

const OP_STATUS: Record<OpStatus, { label: string; badge: string }> = {
  PENDING: { label: 'بانتظار المزامنة', badge: 'badge badge-warning' },
  SYNCING: { label: 'جارٍ المزامنة', badge: 'badge' },
  SYNCED: { label: 'تمت المزامنة', badge: 'badge badge-success' },
  NEEDS_REVIEW: { label: 'تحتاج مراجعة', badge: 'badge badge-danger' },
};

const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic';

/** Loads async local data and reloads it whenever the queue or snapshot changes. */
function useLocal<T>(load: () => Promise<T>): T | undefined {
  const version = useOfflineVersion();
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    void load().then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, [load, version]);
  return value;
}

/** Counts shown in the top bar ("Pending N", spec §54). */
export function useQueueCounts(): { pending: number; review: number } {
  const ops = useLocal(listQueue) ?? [];
  return {
    pending: ops.filter((o) => o.status === 'PENDING' || o.status === 'SYNCING').length,
    review: ops.filter((o) => o.status === 'NEEDS_REVIEW').length,
  };
}

function runSummary(r: SyncRun): string {
  const parts = [`تمت مزامنة ${r.synced}`];
  if (r.review) parts.push(`${r.review} تحتاج مراجعة`);
  if (r.stoppedBy === 'offline') parts.push('توقفت المزامنة لانقطاع الاتصال');
  if (r.stoppedBy === 'session') parts.push('انتهت الجلسة — سجّل الدخول مجددًا لإكمال المزامنة');
  if (r.stoppedBy === 'server') parts.push('الخادم غير متاح حاليًا وستُعاد المحاولة تلقائيًا');
  return parts.join('، ') + '.';
}

// ── Offline center ─────────────────────────────────────────────────────

export function OfflineCenterPage() {
  const { can } = useAuth();
  const online = useOnline();
  const meta = useLocal<Meta | undefined>(getMeta);
  const assetCount = useLocal(countAssets) ?? 0;
  const inventories = useLocal(listInventories) ?? [];
  const queue = useLocal(listQueue);
  const [busy, setBusy] = useState<'refresh' | 'sync' | 'clear' | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const unsynced = (queue ?? []).filter((o) => o.status !== 'SYNCED');

  const refresh = async () => {
    setBusy('refresh');
    setMessage(null);
    try {
      const snap = await refreshSnapshot();
      setMessage({ kind: 'info', text: `تم تنزيل ${snap.assets.length} أصلًا و${snap.inventories.length} جردًا مفتوحًا للعمل بدون اتصال.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'تعذر تنزيل البيانات.' });
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    setMessage(null);
    try {
      setMessage({ kind: 'info', text: runSummary(await processQueue()) });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy('clear');
    await clearLocalData();
    notifyQueueChanged();
    setBusy(null);
    setConfirmClear(false);
    setMessage({ kind: 'info', text: 'حُذفت البيانات المحلية من هذا الجهاز.' });
  };

  const dismiss = async (op: QueuedOp) => {
    await removeOp(op.id);
    notifyQueueChanged();
  };

  const clearSynced = async () => {
    for (const op of queue ?? []) if (op.status === 'SYNCED') await removeOp(op.id);
    notifyQueueChanged();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>العمل بدون اتصال</h1>
          <p className="muted">
            نسخة محدودة من البيانات على هذا الجهاز للبحث عن الأصول والجرد وإضافة الصور والملاحظات بدون شبكة. العمليات الحساسة
            (العهدة، الإرجاع، النقل، البيع، الصيانة، الصلاحيات) تتطلب اتصالًا دائمًا.
          </p>
        </div>
      </div>

      {message && (
        <div className={message.kind === 'error' ? 'alert alert-error' : 'alert alert-info'} role="status">
          {message.text}
        </div>
      )}

      <section className="card">
        <h2>البيانات المحلية</h2>
        <dl className="details">
          <dt>حالة الاتصال</dt>
          <dd>{online ? <span className="badge badge-success">متصل</span> : <span className="badge badge-warning">غير متصل</span>}</dd>
          <dt>آخر تنزيل</dt>
          <dd>{meta ? formatDateTime(meta.generatedAt) : 'لم تُنزَّل بيانات بعد'}</dd>
          <dt>الأصول المحفوظة</dt>
          <dd>
            {assetCount}
            {meta?.truncated && <span className="hint"> — نسخة جزئية؛ قد لا يظهر بعض الأصول بدون اتصال.</span>}
          </dd>
          {can(PERMISSIONS.INVENTORY_MANAGE) && (
            <>
              <dt>الجرد المفتوح</dt>
              <dd>{inventories.length}</dd>
            </>
          )}
        </dl>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={!online || busy !== null} onClick={() => void refresh()}>
            {busy === 'refresh' ? 'جارٍ التنزيل…' : meta ? 'تحديث البيانات المحلية' : 'تنزيل البيانات للعمل بدون اتصال'}
          </button>
          {can(PERMISSIONS.ASSETS_VIEW) && (
            <Link className="btn" to="/offline/lookup">
              البحث عن أصل
            </Link>
          )}
          <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => setConfirmClear(true)}>
            حذف البيانات المحلية
          </button>
        </div>
        {!online && !meta && <p className="hint">يلزم الاتصال مرة واحدة لتنزيل البيانات قبل العمل بدون اتصال.</p>}
      </section>

      {can(PERMISSIONS.INVENTORY_MANAGE) && inventories.length > 0 && (
        <section className="card">
          <h2>الجرد بدون اتصال</h2>
          <ul className="plain-list">
            {inventories.map((inv) => {
              const done = inv.items.filter((i) => i.checkedAt || i.localCheck).length;
              return (
                <li key={inv.id}>
                  <Link to={`/offline/inventories/${inv.id}`}>
                    <bdi className="ltr">{inv.number}</bdi>
                  </Link>{' '}
                  — {inv.scope} — <span className="muted">فُحص {done} من {inv.items.length}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="page-header">
          <h2>قائمة المزامنة</h2>
          <div className="row-actions">
            <button type="button" className="btn btn-sm" disabled={!online || busy !== null || unsynced.length === 0} onClick={() => void sync()}>
              {busy === 'sync' ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
            </button>
            {(queue ?? []).some((o) => o.status === 'SYNCED') && (
              <button type="button" className="btn btn-sm" onClick={() => void clearSynced()}>
                إزالة ما تمت مزامنته
              </button>
            )}
          </div>
        </div>
        {!queue ? (
          <Loading />
        ) : queue.length === 0 ? (
          <Empty>لا توجد عمليات محفوظة على هذا الجهاز.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>العملية</th>
                  <th>وقت التسجيل</th>
                  <th>الحالة</th>
                  <th>التفاصيل</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((op) => (
                  <tr key={op.id}>
                    <td>{op.label}</td>
                    <td>{formatDateTime(op.createdAt)}</td>
                    <td>
                      <span className={OP_STATUS[op.status].badge}>{OP_STATUS[op.status].label}</span>
                    </td>
                    <td className="cell-text">
                      {op.status === 'NEEDS_REVIEW' ? (
                        <span>{op.message ?? 'رفض الخادم العملية.'} لم يُطبَّق شيء على الخادم؛ راجع السجل الحالي وأعد العملية عند الحاجة.</span>
                      ) : op.status === 'SYNCED' ? (
                        formatDateTime(op.syncedAt)
                      ) : op.attempts > 0 ? (
                        <span className="muted">محاولات: {op.attempts}</span>
                      ) : null}
                    </td>
                    <td>
                      {op.status === 'NEEDS_REVIEW' && (
                        <button type="button" className="btn btn-sm" onClick={() => void dismiss(op)}>
                          تمت المراجعة
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmClear}
        title="حذف البيانات المحلية"
        message={
          unsynced.length > 0
            ? `توجد ${unsynced.length} عملية لم تُزامن. حذف البيانات المحلية يحذفها نهائيًا من هذا الجهاز ولن تصل إلى الخادم.`
            : 'تُحذف نسخة البيانات والعمليات المحفوظة على هذا الجهاز. لا يتأثر شيء على الخادم.'
        }
        confirmLabel="حذف البيانات المحلية"
        danger
        busy={busy === 'clear'}
        onConfirm={() => void clear()}
        onClose={() => setConfirmClear(false)}
      />
    </>
  );
}

// ── Offline asset lookup ───────────────────────────────────────────────

export function OfflineLookupPage() {
  const { can } = useAuth();
  const online = useOnline();
  const [asset, setAsset] = useState<LocalAsset | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const meta = useLocal<Meta | undefined>(getMeta);

  const onScan = useCallback(async (code: string) => {
    setSaved(null);
    const found = await findAsset(code);
    setAsset(found ?? null);
    setNotFound(found ? null : code);
  }, []);

  return (
    <>
      <p className="muted">
        <Link to="/offline">العمل بدون اتصال</Link> ›
      </p>
      <h1>البحث عن أصل بدون اتصال</h1>
      {!meta ? (
        <div className="alert alert-warning">
          لا توجد بيانات محلية. <Link to="/offline">نزّل البيانات</Link> أثناء الاتصال أولًا.
        </div>
      ) : (
        <p className="hint">البيانات المحلية بتاريخ {formatDateTime(meta.generatedAt)}؛ قد تكون تغيّرت على الخادم منذ ذلك الحين.</p>
      )}
      <section className="card">
        <QrScanner onResult={(c) => void onScan(c)} />
      </section>
      {notFound && (
        <div className="alert alert-warning">
          الرمز <bdi dir="ltr">{codeToToken(notFound)}</bdi> غير موجود في البيانات المحلية.
        </div>
      )}
      {saved && (
        <div className="alert alert-info" role="status">
          {saved}
        </div>
      )}
      {asset && (
        <section className="card">
          <h2>
            <bdi className="ltr">{asset.assetNumber}</bdi> — {asset.name}
          </h2>
          <dl className="details">
            <dt>الرقم التسلسلي</dt>
            <dd>
              <bdi className="ltr">{asset.serialNumber}</bdi>
            </dd>
            <dt>الحالة</dt>
            <dd>{ASSET_STATUS_LABELS[asset.status]}</dd>
            <dt>الموقع / القسم</dt>
            <dd>
              {asset.location} / {asset.department}
            </dd>
            <dt>المسؤول</dt>
            <dd>{asset.responsible ?? '—'}</dd>
            <dt>ملاحظات</dt>
            <dd>{asset.notes || '—'}</dd>
          </dl>
          {online && (
            <Link className="btn" to={`/assets/${asset.id}`}>
              فتح صفحة الأصل
            </Link>
          )}
          {can(PERMISSIONS.ASSETS_EDIT) && (
            <AssetFieldWork
              key={asset.id}
              asset={asset}
              onSaved={(text, patch) => {
                setSaved(text);
                if (patch) setAsset({ ...asset, ...patch });
              }}
            />
          )}
        </section>
      )}
    </>
  );
}

function AssetFieldWork({ asset, onSaved }: { asset: LocalAsset; onSaved: (text: string, patch?: Partial<LocalAsset>) => void }) {
  const [notes, setNotes] = useState(asset.notes ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const queueNotes = async () => {
    setBusy(true);
    await enqueue({
      type: 'asset.notes',
      fields: { assetId: asset.id, baseVersion: String(asset.version), notes },
      label: `ملاحظات ${asset.assetNumber}`,
      target: `notes:${asset.id}`,
    });
    // The version stays the one the change is based on until the server confirms it.
    await updateLocalAsset(asset.id, { notes: notes || null });
    afterQueue();
    setBusy(false);
    onSaved('حُفظت الملاحظات على الجهاز وستُزامن عند توفر الاتصال.', { notes: notes || null });
  };

  const queuePhoto = async () => {
    if (!photo) return;
    setBusy(true);
    await enqueue({ type: 'asset.photo', fields: { assetId: asset.id }, photo, photoName: photo.name, label: `صورة ${asset.assetNumber}` });
    afterQueue();
    setPhoto(null);
    setBusy(false);
    onSaved('حُفظت الصورة على الجهاز وستُرفع عند توفر الاتصال.');
  };

  return (
    <div className="form-grid" style={{ marginBlockStart: '1rem' }}>
      <div>
        <TextField label="ملاحظات الأصل" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <button type="button" className="btn" disabled={busy || notes === (asset.notes ?? '')} onClick={() => void queueNotes()}>
          حفظ الملاحظات
        </button>
      </div>
      <div className="field">
        <label htmlFor="offline-photo">إضافة صورة</label>
        <input id="offline-photo" type="file" accept={PHOTO_ACCEPT} capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn" disabled={busy || !photo} onClick={() => void queuePhoto()}>
          حفظ الصورة
        </button>
      </div>
    </div>
  );
}

/** Sends right away when online; otherwise the queue waits for the connection. */
function afterQueue() {
  notifyQueueChanged();
  if (navigator.onLine) void processQueue();
}

// ── Offline inventory counting ─────────────────────────────────────────

export function OfflineInventoryPage() {
  const { id = '' } = useParams();
  const load = useCallback(async () => (await getInventory(id)) ?? null, [id]);
  const inv = useLocal<LocalInventory | null>(load);
  const meta = useLocal<Meta | undefined>(getMeta);
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState<{ item: LocalInventoryItem; viaQr: boolean } | null>(null);
  const [unregistered, setUnregistered] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unchecked' | 'checked'>('unchecked');

  if (inv === undefined) return <Loading />;
  if (inv === null)
    return (
      <div className="alert alert-warning">
        هذا الجرد غير محفوظ على الجهاز. <Link to="/offline">حدّث البيانات المحلية</Link> أثناء الاتصال.
      </div>
    );

  const isDone = (i: LocalInventoryItem) => !!(i.checkedAt || i.localCheck);
  const done = inv.items.filter(isDone).length;
  const items = inv.items.filter((i) => (filter === 'all' ? true : filter === 'checked' ? isDone(i) : !isDone(i)));

  const onScan = (code: string) => {
    const token = codeToToken(code);
    const upper = code.trim().toUpperCase();
    const item = inv.items.find((i) => i.qrToken === token || i.assetNumber === upper || i.serialNumber === code.trim());
    setScanning(false);
    if (item) setChecking({ item, viaQr: item.qrToken === token });
    else setUnregistered(code.trim());
  };

  return (
    <>
      <p className="muted">
        <Link to="/offline">العمل بدون اتصال</Link> ›
      </p>
      <div className="page-header">
        <div>
          <h1>
            جرد <bdi className="ltr">{inv.number}</bdi> — بدون اتصال
          </h1>
          <p className="muted">
            {inv.scope} — فُحص {done} من {inv.items.length}
          </p>
        </div>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => setScanning(true)}>
            مسح QR
          </button>
          <button type="button" className="btn" onClick={() => setUnregistered('')}>
            أصل غير مسجل
          </button>
        </div>
      </div>
      <p className="hint">
        تُحفظ النتائج على الجهاز وتُزامن تلقائيًا عند عودة الاتصال. إذا فحص مستخدم آخر الأصل نفسه في الأثناء، تظهر العملية «تحتاج مراجعة» ولا
        تُستبدل نتيجته.
      </p>
      <div className="toolbar" role="tablist">
        {(
          [
            ['unchecked', 'لم يُفحص'],
            ['checked', 'فُحص'],
            ['all', 'الكل'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <Empty>لا توجد أصول في هذا التصنيف.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الأصل</th>
                <th>النتيجة</th>
                <th />
                <th>المكان المتوقع</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <bdi className="ltr">{i.assetNumber}</bdi> — {i.name}
                  </td>
                  <td>
                    {i.localCheck ? (
                      <span className="badge badge-warning">{i.localCheck.exists ? 'موجود' : 'غير موجود'} — على الجهاز</span>
                    ) : i.checkedAt ? (
                      <span className={i.exists ? 'badge badge-success' : 'badge badge-danger'}>{i.exists ? 'موجود' : 'غير موجود'}</span>
                    ) : (
                      <span className="badge">لم يُفحص</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => setChecking({ item: i, viaQr: false })}>
                      {isDone(i) ? 'إعادة الفحص' : 'فحص'}
                    </button>
                  </td>
                  <td>{i.expectedPlace}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scanning && (
        <Modal open title="مسح أصل" onClose={() => setScanning(false)}>
          <QrScanner onResult={onScan} />
        </Modal>
      )}
      {checking && <OfflineCheckDialog inventory={inv} item={checking.item} viaQr={checking.viaQr} meta={meta} onClose={() => setChecking(null)} />}
      {unregistered !== null && <OfflineUnregisteredDialog inventory={inv} code={unregistered} onClose={() => setUnregistered(null)} />}
    </>
  );
}

function OfflineCheckDialog({
  inventory,
  item,
  viaQr,
  meta,
  onClose,
}: {
  inventory: LocalInventory;
  item: LocalInventoryItem;
  viaQr: boolean;
  meta: Meta | undefined;
  onClose: () => void;
}) {
  const [exists, setExists] = useState(item.localCheck?.exists ?? item.exists ?? true);
  const [locationId, setLocationId] = useState(item.expectedLocationId);
  const [departmentId, setDepartmentId] = useState(item.expectedDepartmentId);
  const [status, setStatus] = useState<AssetStatus>(item.expectedStatus);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const locations = meta?.locations ?? [];
  const deps = locations.find((l) => l.id === locationId)?.departments ?? [];

  const save = async () => {
    setBusy(true);
    const fields: Record<string, string> = {
      inventoryId: inventory.id,
      itemId: item.id,
      baseCheckedAt: item.checkedAt ?? '',
      exists: String(exists),
      confirmedByQr: String(viaQr),
      notes,
    };
    if (exists) Object.assign(fields, { actualLocationId: locationId, actualDepartmentId: departmentId, actualStatus: status });
    await enqueue({
      type: 'inventory.check',
      fields,
      photo: photo ?? undefined,
      photoName: photo?.name,
      label: `فحص ${item.assetNumber} — ${inventory.number}`,
      target: `check:${item.id}`,
    });
    await markItemChecked(inventory.id, item.id, exists);
    afterQueue();
    onClose();
  };

  return (
    <Modal
      open
      wide
      title={`فحص ${item.assetNumber} — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={busy || (exists && !departmentId)} onClick={() => void save()}>
            حفظ الفحص
          </button>
          <button type="button" className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {viaQr && <div className="alert alert-info">تم التعرف على الأصل بمسح رمز QR.</div>}
      <div className="toolbar" role="radiogroup" aria-label="نتيجة الفحص">
        <label className="check">
          <input type="radio" name="exists" checked={exists} onChange={() => setExists(true)} /> موجود
        </label>
        <label className="check">
          <input type="radio" name="exists" checked={!exists} onChange={() => setExists(false)} /> غير موجود
        </label>
      </div>
      {exists ? (
        <>
          <p className="muted">
            المتوقع: {item.expectedPlace} — {ASSET_STATUS_LABELS[item.expectedStatus]}
          </p>
          <div className="form-grid">
            <SelectField
              label="الموقع الفعلي"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                setDepartmentId('');
              }}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="القسم الفعلي" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">اختر…</option>
              {deps.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="الحالة الفعلية" value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
              {CHECK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ASSET_STATUS_LABELS[s]}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="hint">تسجيل مسؤول فعلي مختلف يتطلب اتصالًا؛ سجّله من صفحة الجرد عند عودة الاتصال.</p>
        </>
      ) : (
        <div className="alert alert-warning">يُسجَّل الأصل «غير موجود أثناء الجرد» ولا تتغير حالته تلقائيًا.</div>
      )}
      <TextField label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      <div className="field">
        <label htmlFor="offline-check-photo">صورة (اختيارية)</label>
        <input id="offline-check-photo" type="file" accept={PHOTO_ACCEPT} capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </div>
    </Modal>
  );
}

function OfflineUnregisteredDialog({ inventory, code, onClose }: { inventory: LocalInventory; code: string; onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await enqueue({
      type: 'inventory.unregistered',
      fields: { inventoryId: inventory.id, description: description.trim(), scannedCode: code, notes },
      photo: photo ?? undefined,
      photoName: photo?.name,
      label: `أصل غير مسجل — ${inventory.number}`,
    });
    afterQueue();
    onClose();
  };

  return (
    <Modal open title="أصل غير مسجل" onClose={onClose}>
      {code && (
        <div className="alert alert-warning">
          الرمز <bdi dir="ltr">{code}</bdi> لا يطابق أي أصل في هذا الجرد.
        </div>
      )}
      <p className="muted">يُسجَّل الأصل في محضر الجرد فقط، ولا يُنشأ أصل جديد تلقائيًا.</p>
      <TextField label="وصف الأصل *" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} autoFocus />
      <TextField label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      <div className="field">
        <label htmlFor="offline-unreg-photo">صورة (اختيارية)</label>
        <input id="offline-unreg-photo" type="file" accept={PHOTO_ACCEPT} capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </div>
      <button type="button" className="btn btn-primary" disabled={!description.trim() || busy} onClick={() => void save()}>
        تسجيل
      </button>
    </Modal>
  );
}
