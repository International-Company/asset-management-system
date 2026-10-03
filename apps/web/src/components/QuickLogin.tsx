import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isWeakPin } from '@osooli/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { enableQuickLogin, forgetQuickDevice, getQuickDevice, quickLoginSupported } from '../lib/quickLogin';
import { ConfirmDialog, Modal } from './Modal';
import { PinInput } from './PinInput';
import { Empty, ErrorState, Loading } from './States';

/** Set by the login page after a full sign-in; the shell then offers quick sign-in once. */
export const OFFER_FLAG = 'osooli.offerQuick';
/** «لا تسألني مرة أخرى» on this device. */
export const NEVER_KEY = 'osooli.quickNever';

export function useQuickDevice() {
  return useQuery({ queryKey: ['quick-device'], queryFn: getQuickDevice, staleTime: Infinity, gcTime: Infinity });
}

/** Choose a PIN twice, then set up this device. */
function SetupForm({ onDone, onCancel, cancelLabel }: { onDone: () => void; onCancel?: () => void; cancelLabel?: string }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState<'pin' | 'confirm'>('pin');
  const [error, setError] = useState<string | null>(null);

  const enable = useMutation({
    mutationFn: (p: string) => enableQuickLogin(p, { id: me!.id, username: me!.username, fullName: me!.fullName }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['quick-device'] });
      await queryClient.invalidateQueries({ queryKey: ['quick-devices', 'mine'] });
      onDone();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? (err.fields?.pin?.[0] ?? err.message) : 'تعذر تفعيل الدخول السريع على هذا الجهاز.');
      setPin('');
      setConfirm('');
      setStage('pin');
    },
  });

  const choose = (p: string) => {
    if (isWeakPin(p)) {
      setError('هذا الرمز سهل التخمين. اختر رمزًا لا تتكرر أرقامه ولا تتسلسل مثل 1234.');
      setPin('');
      return;
    }
    setError(null);
    setStage('confirm');
  };
  const check = (c: string) => {
    if (c !== pin) {
      setError('الرمزان غير متطابقين. أعد اختيار الرمز.');
      setPin('');
      setConfirm('');
      setStage('pin');
      return;
    }
    enable.mutate(c);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (stage === 'pin' && pin.length === 4) choose(pin);
    else if (stage === 'confirm' && confirm.length === 4) check(confirm);
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="muted" style={{ textAlign: 'center' }}>
        {stage === 'pin' ? 'اختر رمزًا من أربعة أرقام للدخول من هذا الجهاز.' : 'أدخل الرمز مرة أخرى للتأكيد.'}
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {stage === 'pin' ? (
        <PinInput key="pin" id="quick-pin-new" label="الرمز الجديد" value={pin} onChange={setPin} onComplete={choose} autoFocus invalid={!!error} />
      ) : (
        <PinInput key="confirm" id="quick-pin-confirm" label="تأكيد الرمز" value={confirm} onChange={setConfirm} onComplete={check} autoFocus disabled={enable.isPending} />
      )}
      <div className="modal-footer" style={{ paddingInline: 0, borderBlockStart: 0, marginBlockStart: '1.25rem' }}>
        <button type="submit" className="btn btn-primary" disabled={enable.isPending || (stage === 'pin' ? pin.length < 4 : confirm.length < 4)}>
          {enable.isPending ? 'جارٍ التفعيل…' : stage === 'pin' ? 'التالي' : 'تفعيل'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel ?? 'إلغاء'}
          </button>
        )}
      </div>
    </form>
  );
}

/** Offered once after a full sign-in on a device without quick sign-in. */
export function QuickLoginOffer() {
  const { me } = useAuth();
  const device = useQuickDevice();
  const [offered] = useState(() => {
    try {
      const flag = sessionStorage.getItem(OFFER_FLAG) === '1';
      sessionStorage.removeItem(OFFER_FLAG);
      return flag;
    } catch {
      return false;
    }
  });
  const [closed, setClosed] = useState(false);
  const [done, setDone] = useState(false);

  if (!me || !offered || closed || device.isPending || !quickLoginSupported()) return null;
  let never = false;
  try {
    never = localStorage.getItem(NEVER_KEY) === '1';
  } catch {
    // Storage unavailable: ask anyway.
  }
  if (!done && (never || device.data?.userId === me.id)) return null;

  return (
    <Modal open title="الدخول السريع بالرمز" onClose={() => setClosed(true)}>
      {done ? (
        <>
          <div className="alert alert-success">تم التفعيل. في المرة القادمة ادخل من هذا الجهاز بالرمز فقط.</div>
          <div className="modal-footer" style={{ paddingInline: 0, borderBlockStart: 0 }}>
            <button type="button" className="btn btn-primary" onClick={() => setClosed(true)} autoFocus>
              حسنًا
            </button>
          </div>
        </>
      ) : (
        <>
          <p>ادخل أسرع في المرة القادمة: رمز من أربعة أرقام يعمل على هذا الجهاز فقط. بعد 5 محاولات خاطئة يُلغى ويلزم الدخول بكلمة المرور.</p>
          <SetupForm onDone={() => setDone(true)} onCancel={() => setClosed(true)} cancelLabel="ليس الآن" />
          <button
            type="button"
            className="btn-link"
            style={{ display: 'block', marginInline: 'auto', marginBlockStart: '0.75rem' }}
            onClick={() => {
              try {
                localStorage.setItem(NEVER_KEY, '1');
              } catch {
                // Not remembered; harmless.
              }
              setClosed(true);
            }}
          >
            لا تسألني مرة أخرى
          </button>
        </>
      )}
    </Modal>
  );
}

interface QuickDeviceRow {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** «جلساتي»: the devices that can sign in with the PIN, and setting up this one. */
export function MyQuickLogin() {
  const queryClient = useQueryClient();
  const device = useQuickDevice();
  const { me } = useAuth();
  const [setup, setSetup] = useState(false);
  const [removing, setRemoving] = useState<QuickDeviceRow | null>(null);
  const list = useQuery({ queryKey: ['quick-devices', 'mine'], queryFn: () => api<QuickDeviceRow[]>('/auth/quick/devices') });
  const thisDevice = device.data?.userId === me?.id ? device.data?.deviceId : undefined;

  const remove = useMutation({
    mutationFn: (id: string) => api(`/auth/quick/devices/${id}`, { method: 'DELETE' }),
    onSuccess: async (_r, id) => {
      if (id === thisDevice) await forgetQuickDevice();
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: ['quick-device'] });
      await queryClient.invalidateQueries({ queryKey: ['quick-devices', 'mine'] });
    },
  });

  return (
    <section className="card" style={{ marginBlockStart: '1.5rem' }} aria-labelledby="quick-title">
      <div className="page-header">
        <div>
          <h2 id="quick-title">الدخول السريع بالرمز</h2>
          <p className="muted">رمز من أربعة أرقام يعمل فقط على الجهاز الذي فُعّل عليه. بعد 5 محاولات خاطئة يُلغى على ذلك الجهاز.</p>
        </div>
        {quickLoginSupported() && (
          <button type="button" className="btn" onClick={() => setSetup(true)}>
            {thisDevice ? 'تغيير الرمز على هذا الجهاز' : 'تفعيل على هذا الجهاز'}
          </button>
        )}
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <Empty>الدخول السريع غير مفعّل على أي جهاز.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الجهاز</th>
                <th>تاريخ التفعيل</th>
                <th>آخر استخدام</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.deviceName ?? 'جهاز غير معروف'} {d.id === thisDevice && <span className="badge badge-success">هذا الجهاز</span>}
                  </td>
                  <td>{formatDateTime(d.createdAt)}</td>
                  <td>{formatDateTime(d.lastUsedAt)}</td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => setRemoving(d)}>
                      إلغاء
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={setup} title="الدخول السريع بالرمز" onClose={() => setSetup(false)}>
        <SetupForm onDone={() => setSetup(false)} onCancel={() => setSetup(false)} />
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title="إلغاء الدخول السريع"
        message={`لن يستطيع الجهاز «${removing?.deviceName ?? 'جهاز غير معروف'}» الدخول بالرمز بعد الآن، وسيلزمه الدخول بكلمة المرور.`}
        confirmLabel="إلغاء الدخول السريع"
        danger
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
