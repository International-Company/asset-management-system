import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMINISTRATOR: 'مدير النظام',
  ASSET_MANAGER: 'مدير الأصول',
};

export function HomePage() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <>
      <div className="page-header">
        <div>
          <h1>مرحبًا، {me.fullName}</h1>
          <p className="muted">نظام إدارة أصول {me.company.nameAr}</p>
        </div>
      </div>
      <PendingConfirmations />
      <div className="card">
        <h2>حسابك</h2>
        <dl className="details">
          <dt>اسم المستخدم</dt>
          <dd>
            <bdi dir="ltr">{me.username}</bdi>
          </dd>
          <dt>الأدوار</dt>
          <dd>{me.roles.map((r) => ROLE_LABELS[r] ?? r).join('، ') || '—'}</dd>
          <dt>عدد الصلاحيات</dt>
          <dd>{me.permissions.length}</dd>
        </dl>
      </div>
    </>
  );
}

interface PendingCustody {
  id: string;
  number: string;
  createdAt: string;
  newResponsibleEmployee: { fullName: string } | null;
  newResponsibleExternal: { name: string } | null;
  items: Array<{ asset: { assetNumber: string; name: string } }>;
}

/** Custody records awaiting the signed-in user's confirmation (spec §25, §68). */
function PendingConfirmations() {
  const pending = useQuery({ queryKey: ['custodies', 'pending-for-me'], queryFn: () => api<PendingCustody[]>('/custodies/pending-for-me') });
  if (!pending.data?.length) return null;
  return (
    <section className="card" aria-labelledby="pending-title">
      <h2 id="pending-title">محاضر عهدة بانتظار تأكيدك ({pending.data.length})</h2>
      <ul className="pick-list">
        {pending.data.map((c) => (
          <li key={c.id}>
            <Link className="btn btn-sm btn-primary" to={`/custodies/${c.id}`}>
              مراجعة
            </Link>
            <span>
              <bdi dir="ltr">{c.number}</bdi> — {c.items.length} أصل
              {c.newResponsibleExternal && <> (بالنيابة عن {c.newResponsibleExternal.name})</>}
              <span className="muted"> — {formatDateTime(c.createdAt)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
