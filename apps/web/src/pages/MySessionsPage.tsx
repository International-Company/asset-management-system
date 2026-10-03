import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { createPasskey, PasskeyCancelled, passkeysSupported } from '../lib/passkey';
import { ConfirmDialog, Modal } from '../components/Modal';
import { MyQuickLogin } from '../components/QuickLogin';
import { Empty, ErrorState, Loading } from '../components/States';
import { SessionStatusBadge, type SessionRow } from './sessions';

/** The signed-in user's recent sessions (spec §49). */
export function MySessionsPage() {
  const query = useQuery({
    queryKey: ['sessions', 'mine'],
    queryFn: () => api<{ items: Array<SessionRow & { current: boolean }> }>('/security/sessions/mine'),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>جلساتي</h1>
          <p className="muted">آخر عمليات الدخول إلى حسابك.</p>
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <Empty>لا توجد جلسات.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>وقت الدخول</th>
                <th>آخر نشاط</th>
                <th>الجهاز</th>
                <th>المتصفح</th>
                <th>عنوان IP</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((s) => (
                <tr key={s.id}>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>{formatDateTime(s.lastSeenAt)}</td>
                  <td>{s.device ?? '—'}</td>
                  <td>{s.browser ?? '—'}</td>
                  <td>
                    <bdi dir="ltr">{s.ip ?? '—'}</bdi>
                  </td>
                  <td>
                    <SessionStatusBadge status={s.status} />
                    {s.current && <span className="badge"> الجلسة الحالية</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MyPasskeys />
      <MyQuickLogin />
    </>
  );
}

interface Passkey {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The devices whose fingerprint signs this account in (spec §47). Only public
 * keys are stored; the fingerprint stays on each device.
 */
function MyPasskeys() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const enabled = me?.fingerprintMode === 'passkey';
  const list = useQuery({ queryKey: ['passkeys', 'mine'], queryFn: () => api<Passkey[]>('/auth/passkeys'), enabled });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['passkeys', 'mine'] });

  const add = useMutation({
    mutationFn: async () => {
      const begin = await api<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/auth/passkeys/options', { method: 'POST' });
      const credential = JSON.parse(await createPasskey(begin.options));
      return api<Passkey[]>('/auth/passkeys', { method: 'POST', json: { challengeId: begin.challengeId, credential } });
    },
    onSuccess: () => void refresh(),
  });
  const linkCode = useMutation({ mutationFn: () => api<LinkCode>('/auth/passkeys/link-code', { method: 'POST' }) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/auth/passkeys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
  });

  if (!enabled) return null;
  const linkError = linkCode.error instanceof ApiError ? linkCode.error.message : null;
  const addError =
    add.error instanceof PasskeyCancelled
      ? 'لم يكتمل تسجيل البصمة على هذا الجهاز.'
      : add.error instanceof ApiError
        ? add.error.message
        : null;
  const count = list.data?.length ?? 0;

  return (
    <section className="card" style={{ marginBlockStart: '1.5rem' }} aria-labelledby="passkeys-title">
      <div className="page-header">
        <div>
          <h2 id="passkeys-title">بصماتي</h2>
          <p className="muted">الأجهزة التي تستطيع الدخول ببصمتك. تبقى البصمة على كل جهاز، ولا يُحفظ في النظام إلا مفتاح عام.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" disabled={linkCode.isPending} onClick={() => linkCode.mutate()}>
            {linkCode.isPending ? 'جارٍ الإنشاء…' : 'ربط جهاز جديد'}
          </button>
          {passkeysSupported() && (
            <button type="button" className="btn" disabled={add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? 'جارٍ التسجيل…' : 'إضافة هذا الجهاز'}
            </button>
          )}
        </div>
      </div>
      {linkError && (
        <div className="alert alert-error" role="alert">
          {linkError}
        </div>
      )}
      {addError && (
        <div className="alert alert-error" role="alert">
          {addError}
        </div>
      )}
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : count === 0 ? (
        <Empty>لا توجد بصمات مسجلة.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الجهاز</th>
                <th>تاريخ التسجيل</th>
                <th>آخر استخدام</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.deviceName ?? 'جهاز غير معروف'}</td>
                  <td>{formatDateTime(p.createdAt)}</td>
                  <td>{formatDateTime(p.lastUsedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={count === 1}
                      title={count === 1 ? 'لا يمكن حذف آخر بصمة. أضف جهازًا آخر أولًا.' : undefined}
                      onClick={() => setRemoving(p)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {linkCode.data && <LinkCodeDialog code={linkCode.data} onClose={() => linkCode.reset()} onRenew={() => linkCode.mutate()} />}
      <ConfirmDialog
        open={!!removing}
        title="حذف البصمة"
        message={`لن يستطيع الجهاز «${removing?.deviceName ?? 'جهاز غير معروف'}» الدخول إلى حسابك بعد الآن.`}
        confirmLabel="حذف البصمة"
        danger
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

interface LinkCode {
  code: string;
  expiresAt: string;
}

/** The one-time code to type on the new device, with the time it has left. */
function LinkCodeDialog({ code, onClose, onRenew }: { code: LinkCode; onClose: () => void; onRenew: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000));
  const expired = left === 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Modal open title="ربط جهاز جديد" onClose={onClose}>
      <ol className="link-steps">
        <li>على الجهاز الجديد افتح أصولي، وادخل باسم المستخدم وكلمة المرور.</li>
        <li>في خطوة البصمة اضغط «جهاز جديد؟ اربطه برمز».</li>
        <li>اكتب هذا الرمز، ثم سجّل بصمة الجهاز الجديد.</li>
      </ol>
      <div className="link-code" data-expired={expired || undefined} aria-label={`رمز الربط ${code.code.split('').join(' ')}`} role="group">
        <bdi dir="ltr">{`${code.code.slice(0, 3)} ${code.code.slice(3)}`}</bdi>
      </div>
      <p className="muted" style={{ textAlign: 'center' }} aria-live="polite">
        {expired ? 'انتهت صلاحية الرمز.' : `صالح لمرة واحدة، وينتهي بعد ${clock}`}
      </p>
      <div className="modal-footer" style={{ paddingInline: 0, borderBlockStart: 0 }}>
        {expired ? (
          <button type="button" className="btn btn-primary" onClick={onRenew}>
            رمز جديد
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            تم
          </button>
        )}
      </div>
    </Modal>
  );
}
