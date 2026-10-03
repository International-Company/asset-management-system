import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { OFFER_FLAG, useQuickDevice } from '../components/QuickLogin';
import { PinInput } from '../components/PinInput';
import { forgetQuickDevice, type QuickDevice, quickSignIn } from '../lib/quickLogin';
import { createPasskey, type FingerprintOptions, PasskeyCancelled, passkeysSupported, signWithPasskey } from '../lib/passkey';

type Step = 'username' | 'password' | 'fingerprint';

interface AuthConfig {
  authProvider: 'mock' | 'eap';
  company: { nameAr: string; nameEn: string };
}

const STEP_LABELS: Record<Step, string> = {
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  fingerprint: 'التحقق بالبصمة',
};
const ORDER: Step[] = ['username', 'password', 'fingerprint'];

/** Login flow (spec §47): username → password → fingerprint. */
export function LoginPage() {
  const { me, refresh, signedOutReason } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [assertion, setAssertion] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<FingerprintOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linked, setLinked] = useState(false);
  const quick = useQuickDevice();

  const config = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => api<AuthConfig>('/auth/config'),
    staleTime: Infinity,
  });

  if (me) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  if (quick.isPending) return null;
  if (quick.data && !usePassword) {
    return (
      <QuickPinLogin
        device={quick.data}
        companyName={config.data?.company.nameAr}
        notice={signedOutReason}
        onPassword={(message) => {
          setUsePassword(true);
          setUsername(quick.data?.username ?? '');
          setError(message ?? null);
        }}
        onSignedIn={refresh}
      />
    );
  }

  const restart = (message?: string) => {
    setStep('username');
    setChallengeId(null);
    setPassword('');
    setAssertion('');
    setFingerprint(null);
    setLinking(false);
    setLinkCode('');
    setLinked(false);
    setError(message ?? null);
  };

  /** `typedCode`: the link code as just typed (state may not have caught up yet). */
  async function submit(e?: FormEvent, typedCode?: string) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'fingerprint' && linking) {
        // A one-time code from a signed-in device: this device may now register its fingerprint.
        const res = await api<{ fingerprint: FingerprintOptions }>('/auth/login/link', { method: 'POST', json: { challengeId, code: typedCode ?? linkCode } });
        setFingerprint(res.fingerprint);
        setLinking(false);
        setLinked(true);
        return;
      }
      if (step === 'username') {
        const res = await api<{ challengeId: string }>('/auth/login/start', { method: 'POST', json: { username } });
        setChallengeId(res.challengeId);
        setStep('password');
      } else if (step === 'password') {
        const res = await api<{ fingerprint: FingerprintOptions }>('/auth/login/password', { method: 'POST', json: { challengeId, password } });
        setPassword('');
        setFingerprint(res.fingerprint);
        setStep('fingerprint');
      } else {
        // The device checks the fingerprint and signs this system's challenge
        // (or, on first sign-in, creates the passkey that will be used from now on).
        const signed =
          fingerprint?.type === 'passkey'
            ? await signWithPasskey(fingerprint.options)
            : fingerprint?.type === 'passkey-register'
              ? await createPasskey(fingerprint.options)
              : assertion;
        await api('/auth/login/fingerprint', { method: 'POST', json: { challengeId, assertion: signed } });
        try {
          sessionStorage.setItem(OFFER_FLAG, '1');
        } catch {
          // No offer this time; it stays available in «جلساتي».
        }
        await refresh();
      }
    } catch (err) {
      if (err instanceof PasskeyCancelled) {
        setError(
          fingerprint?.type === 'passkey-register'
            ? 'لم يكتمل تسجيل البصمة. تأكد أن في الجهاز مستشعر بصمة (أو Windows Hello) مفعّلًا، ثم أعد المحاولة.'
            : 'لم يكتمل التحقق من البصمة. إن كان هذا جهازًا جديدًا فاضغط «جهاز جديد؟ اربطه برمز»، واطلب الرمز من «جلساتي ← بصماتي» على جهازك الأول.',
        );
        return;
      }
      const apiErr = err instanceof ApiError ? err : null;
      if (linking && (apiErr?.code === 'INVALID_CREDENTIALS' || apiErr?.code === 'VALIDATION_ERROR')) {
        // A wrong code: try again in the same attempt.
        setLinkCode('');
        setError(apiErr.message);
        return;
      }
      if (apiErr?.code === 'SESSION_EXPIRED' || apiErr?.code === 'ACCOUNT_LOCKED' || apiErr?.code === 'FORBIDDEN') {
        restart(apiErr.message);
      } else if (apiErr?.code === 'INVALID_CREDENTIALS') {
        // A new challenge is needed after a failed password.
        restart(apiErr.message);
      } else {
        setError(apiErr?.message ?? 'حدث خطأ غير متوقع.');
      }
    } finally {
      setBusy(false);
    }
  }

  const companyName = config.data?.company.nameAr;
  const usesCode = fingerprint?.type === 'code';
  const usesPasskey = fingerprint?.type === 'passkey' || fingerprint?.type === 'passkey-register';
  const registering = fingerprint?.type === 'passkey-register';
  const canSubmitFingerprint = linking ? linkCode.length === 6 : usesCode ? !!assertion : usesPasskey && passkeysSupported();

  return (
    <div className="center-page">
      <div className="card center-card">
        <h1>تسجيل الدخول</h1>
        <p className="muted">{companyName ? `${companyName} — نظام إدارة الأصول` : 'نظام إدارة الأصول'}</p>

        <ol className="steps" aria-label="خطوات تسجيل الدخول">
          {ORDER.map((s, i) => (
            <li
              key={s}
              data-state={s === step ? 'active' : ORDER.indexOf(step) > i ? 'done' : 'pending'}
              aria-current={s === step ? 'step' : undefined}
            >
              {STEP_LABELS[s]}
            </li>
          ))}
        </ol>

        {(error ?? signedOutReason) && (
          <div className="alert alert-error" role="alert">
            {error ?? signedOutReason}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          {step === 'username' && (
            <div className="field">
              <label htmlFor="username">اسم المستخدم</label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                autoFocus
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}

          {step === 'password' && (
            <>
              <p className="muted">
                المستخدم: <bdi dir="ltr">{username}</bdi>{' '}
                <button type="button" className="btn-link" onClick={() => restart()}>
                  تغيير
                </button>
              </p>
              <div className="field">
                <label htmlFor="password">كلمة المرور</label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  autoFocus
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {step === 'fingerprint' && (
            <>
              {usesCode ? (
                <div className="field">
                  <label htmlFor="assertion">رمز محاكاة البصمة</label>
                  <input
                    id="assertion"
                    className="input"
                    autoFocus
                    dir="ltr"
                    inputMode="numeric"
                    value={assertion}
                    onChange={(e) => setAssertion(e.target.value)}
                    required
                  />
                  <span className="hint">بيئة التطوير: مزود المصادقة التجريبي يحاكي خطوة البصمة.</span>
                </div>
              ) : linking ? (
                <>
                  <p>اكتب رمز الربط الظاهر على جهازك الآخر («جلساتي ← بصماتي ← ربط جهاز جديد»).</p>
                  <PinInput id="link-code" label="رمز الربط" length={6} secret={false} value={linkCode} onChange={setLinkCode} onComplete={(v) => void submit(undefined, v)} disabled={busy} autoFocus invalid={!!error} />
                  <div className="quick-alt" style={{ marginBlockEnd: '1rem' }}>
                    <button type="button" className="btn-link" onClick={() => { setLinking(false); setLinkCode(''); setError(null); }}>
                      رجوع إلى التحقق بالبصمة
                    </button>
                  </div>
                </>
              ) : passkeysSupported() && registering ? (
                <>
                  <div className="alert alert-info">
                    {linked ? 'تم قبول رمز الربط: سجّل بصمة هذا الجهاز الآن. ستبقى بصمة جهازك الآخر كما هي.' : 'هذا أول دخول لك من هذا الحساب: سجّل بصمتك الآن. ستُستخدم في كل دخول لاحق.'}
                  </div>
                  <p>اضغط «تسجيل البصمة» ثم ضع إصبعك على مستشعر البصمة في جهازك. تبقى البصمة على الجهاز ولا تُرسل إلى أي خادم.</p>
                </>
              ) : passkeysSupported() ? (
                <>
                  <p>اضغط «التحقق بالبصمة» ثم ضع إصبعك على مستشعر البصمة في جهازك. تبقى البصمة على الجهاز ولا تُرسل إلى أي خادم.</p>
                  <div className="quick-alt" style={{ marginBlock: '0 1rem' }}>
                    <button type="button" className="btn-link" onClick={() => { setLinking(true); setError(null); }}>
                      جهاز جديد؟ اربطه برمز
                    </button>
                  </div>
                </>
              ) : (
                <div className="alert alert-warning">هذا المتصفح لا يدعم الدخول بالبصمة (Passkey). استخدم متصفحًا حديثًا على جهاز فيه مستشعر بصمة.</div>
              )}
            </>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy || (step === 'fingerprint' && !canSubmitFingerprint)}
          >
            {busy ? 'جارٍ التحقق…' : step === 'fingerprint' && linking ? 'ربط الجهاز' : step === 'fingerprint' ? (registering ? 'تسجيل البصمة' : usesPasskey ? 'التحقق بالبصمة' : 'دخول') : 'متابعة'}
          </button>
        </form>
        {quick.data && step === 'username' && (
          <div className="quick-alt">
            <button type="button" className="btn-link" onClick={() => setUsePassword(false)}>
              الدخول بالرمز
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Quick sign-in on a device set up for it: the name, four PIN boxes, nothing else. */
function QuickPinLogin({
  device,
  companyName,
  notice,
  onPassword,
  onSignedIn,
}: {
  device: QuickDevice;
  companyName?: string;
  notice: string | null;
  onPassword: (message?: string) => void;
  onSignedIn: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(value: string) {
    if (busy || value.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      await quickSignIn(device, value);
      await onSignedIn();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setPin('');
      if (apiErr?.code === 'INVALID_STATE') {
        // Revoked (too many wrong PINs, removed, or reset by an admin): back to the full sign-in.
        await forgetQuickDevice();
        await queryClient.invalidateQueries({ queryKey: ['quick-device'] });
        onPassword(apiErr.message);
        return;
      }
      setError(apiErr?.message ?? 'تعذر الدخول. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  const initial = device.fullName.trim().charAt(0);
  return (
    <div className="center-page">
      <div className="card center-card">
        <h1>تسجيل الدخول</h1>
        <p className="muted">{companyName ? `${companyName} — نظام إدارة الأصول` : 'نظام إدارة الأصول'}</p>
        <div className="quick-who">
          <span className="quick-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="quick-name">{device.fullName}</span>
          <span className="muted">أدخل رمز الدخول السريع</span>
        </div>
        {(error ?? notice) && (
          <div className="alert alert-error" role="alert">
            {error ?? notice}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn(pin);
          }}
          noValidate
        >
          <PinInput id="quick-pin" label="رمز الدخول السريع" value={pin} onChange={setPin} onComplete={(v) => void signIn(v)} disabled={busy} autoFocus invalid={!!error} />
          <button type="submit" className="btn btn-primary btn-block" style={{ marginBlockStart: '1.25rem' }} disabled={busy || pin.length < 4}>
            {busy ? 'جارٍ التحقق…' : 'دخول'}
          </button>
        </form>
        <div className="quick-alt">
          <button type="button" className="btn-link" onClick={() => onPassword()}>
            الدخول بكلمة المرور
          </button>
        </div>
      </div>
    </div>
  );
}
