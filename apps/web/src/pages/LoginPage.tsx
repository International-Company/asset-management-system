import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const config = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => api<AuthConfig>('/auth/config'),
    staleTime: Infinity,
  });

  if (me) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const restart = (message?: string) => {
    setStep('username');
    setChallengeId(null);
    setPassword('');
    setAssertion('');
    setError(message ?? null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'username') {
        const res = await api<{ challengeId: string }>('/auth/login/start', { method: 'POST', json: { username } });
        setChallengeId(res.challengeId);
        setStep('password');
      } else if (step === 'password') {
        await api('/auth/login/password', { method: 'POST', json: { challengeId, password } });
        setPassword('');
        setStep('fingerprint');
      } else {
        await api('/auth/login/fingerprint', { method: 'POST', json: { challengeId, assertion } });
        await refresh();
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
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
  const isMock = config.data?.authProvider === 'mock';

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
              <p>يرجى إتمام التحقق من البصمة عبر جهاز البصمة المعتمد في الشركة.</p>
              {isMock ? (
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
              ) : (
                <div className="alert alert-warning">
                  آلية البصمة عبر EAP لم تُهيأ بعد. يرجى التواصل مع مدير النظام.
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={busy || (step === 'fingerprint' && !isMock)}
          >
            {busy ? 'جارٍ التحقق…' : step === 'fingerprint' ? 'دخول' : 'متابعة'}
          </button>
        </form>
      </div>
    </div>
  );
}
