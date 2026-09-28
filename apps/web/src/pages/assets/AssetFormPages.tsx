import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { ErrorState, Loading } from '../../components/States';
import { AssetForm, valuesFromAsset } from './AssetForm';
import type { AssetDetail } from './types';

export function AssetNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ id: string }>('/assets', { method: 'POST', json: body }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['/assets'] });
      navigate(`/assets/${res.id}`);
    },
  });
  useEffect(() => {
    if (create.isError) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [create.isError]);

  return (
    <>
      <p className="muted">
        <Link to="/assets">الأصول</Link> / أصل جديد
      </p>
      <h1>أصل جديد</h1>
      <p className="muted">يُولَّد رقم الأصل ورمز QR تلقائيًا عند الحفظ.</p>
      <AssetForm mode="create" initial={valuesFromAsset()} submitLabel="حفظ الأصل" onSubmit={(b) => create.mutate(b)} pending={create.isPending} error={create.error} />
    </>
  );
}

export function AssetEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const asset = useQuery({ queryKey: ['assets', id], queryFn: () => api<AssetDetail>(`/assets/${id}`) });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/assets/${id}`, { method: 'PATCH', json: { ...body, version: asset.data!.version } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets', id] });
      void queryClient.invalidateQueries({ queryKey: ['/assets'] });
      navigate(`/assets/${id}`);
    },
  });

  if (asset.isPending) return <Loading />;
  if (asset.isError) return <ErrorState error={asset.error} onRetry={() => void asset.refetch()} />;
  if (asset.data.status === 'SOLD') return <Navigate to={`/assets/${id}`} replace />;
  const a = asset.data;
  return (
    <>
      <p className="muted">
        <Link to="/assets">الأصول</Link> / <Link to={`/assets/${id}`}>{a.assetNumber}</Link> / تعديل
      </p>
      <h1>
        تعديل: <bdi dir="ltr">{a.assetNumber}</bdi> — {a.name}
      </h1>
      <p className="muted">ستُعرض التغييرات (القيمة القديمة ← الجديدة) للتأكيد قبل الحفظ.</p>
      <AssetForm mode="edit" initial={valuesFromAsset(a)} submitLabel="مراجعة وحفظ" onSubmit={(b) => save.mutate(b)} pending={save.isPending} error={save.error} />
    </>
  );
}

/** Target of scanned QR codes: /qr/{token} → the asset page (spec §9). Signing in is required. */
export function QrResolvePage() {
  const { token } = useParams<{ token: string }>();
  const resolved = useQuery({ queryKey: ['qr', token], queryFn: () => api<{ id: string }>(`/qr/resolve/${token}`), retry: false });
  if (resolved.isPending) return <Loading label="جارٍ البحث عن الأصل…" />;
  if (resolved.isError) {
    return (
      <div className="card">
        <h1>رمز QR غير معروف</h1>
        <p className="muted">لا يطابق هذا الرمز أي أصل مسجل.</p>
        <Link to="/assets">العودة إلى الأصول</Link>
      </div>
    );
  }
  return <Navigate to={`/assets/${resolved.data.id}`} replace />;
}
