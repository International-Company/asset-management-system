import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../../lib/api';
import { ME_QUERY_KEY, useAuth } from '../../lib/auth';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, Tabs } from '../../components/DataTable';
import { fieldErrors, FormAlert, formError, SelectField, StatusBadge, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { ErrorState, Loading } from '../../components/States';
import type { Status } from './types';
import { useRecordActions } from './useRecordActions';

interface SettingsValues {
  'company.nameAr': string;
  'company.nameEn': string;
  'currency.default': string;
  'files.maxSizeMb': number;
  'files.allowedExtensions': string[];
  'security.maxFailedAttempts': number;
  'security.lockoutMinutes': number;
  'security.sessionIdleMinutes': number;
  'security.sessionMaxHours': number;
}
interface SettingsResponse {
  values: SettingsValues;
  allowableExtensions: string[];
}
interface Currency {
  code: string;
  nameAr: string;
  symbol: string | null;
  status: Status;
}

type Tab = 'company' | 'security' | 'files' | 'currencies' | 'numbering' | 'providers' | 'notifications';
const TABS: Array<[Tab, string]> = [
  ['company', 'هوية الشركة'],
  ['security', 'الأمان'],
  ['files', 'الملفات'],
  ['currencies', 'العملات'],
  ['numbering', 'الترقيم'],
  ['providers', 'فنيو وشركات الصيانة'],
  ['notifications', 'الإشعارات'],
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'company') as Tab;
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>إعدادات النظام</h1>
          <p className="muted">كل تغيير يُسجَّل في سجل التدقيق (القيمة القديمة ← الجديدة)، وتغييرات الأمان في السجل الأمني أيضًا.</p>
        </div>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'currencies' ? (
        <CurrenciesTab />
      ) : tab === 'numbering' ? (
        <NumberingTab />
      ) : tab === 'providers' ? (
        <ProvidersTab />
      ) : tab === 'notifications' ? (
        <NotificationTypesTab />
      ) : settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <ValuesTab key={tab} tab={tab} data={settings.data} />
      )}
    </>
  );
}

/** Client-side checks mirroring the server rules, so users get Arabic messages before submitting (spec §71). */
const NUMBER_RULES: Partial<Record<keyof SettingsValues, [number, number, string]>> = {
  'files.maxSizeMb': [1, 100, 'رقم صحيح من 1 إلى 100 ميغابايت.'],
  'security.maxFailedAttempts': [3, 20, 'رقم صحيح من 3 إلى 20.'],
  'security.lockoutMinutes': [1, 1440, 'رقم صحيح من 1 إلى 1440 دقيقة.'],
  'security.sessionIdleMinutes': [5, 480, 'رقم صحيح من 5 إلى 480 دقيقة.'],
  'security.sessionMaxHours': [1, 72, 'رقم صحيح من 1 إلى 72 ساعة.'],
};

function validate(values: SettingsValues, keys: Array<keyof SettingsValues>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    const rule = NUMBER_RULES[key];
    const v = values[key];
    if (rule && (typeof v !== 'number' || !Number.isInteger(v) || v < rule[0] || v > rule[1])) out[key] = [rule[2]];
    if ((key === 'company.nameAr' || key === 'company.nameEn') && !String(v).trim()) out[key] = ['هذا الحقل مطلوب.'];
    if (key === 'files.allowedExtensions' && (v as string[]).length === 0) out[key] = ['يجب اختيار نوع واحد على الأقل.'];
  }
  return out;
}

function ValuesTab({ tab, data }: { tab: 'company' | 'security' | 'files'; data: SettingsResponse }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<SettingsValues>(data.values);
  const [saved, setSaved] = useState(false);
  const currencies = useQuery({ queryKey: ['settings', 'currencies'], queryFn: () => api<Currency[]>('/settings/currencies'), enabled: tab === 'company' });
  const save = useMutation({
    mutationFn: (changes: Partial<SettingsValues>) => api<SettingsValues>('/settings', { method: 'PATCH', json: { values: changes } }),
    onSuccess: (next) => {
      queryClient.setQueryData<SettingsResponse>(['settings'], (old) => (old ? { ...old, values: next } : old));
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'config'] });
      setSaved(true);
    },
  });
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>({});
  const errors = { ...fieldErrors(save.error), ...clientErrors };

  const keys = (Object.keys(values) as Array<keyof SettingsValues>).filter((k) =>
    tab === 'company' ? k.startsWith('company.') || k === 'currency.default' : k.startsWith(`${tab}.`),
  );
  const changed = keys.filter((k) => JSON.stringify(values[k]) !== JSON.stringify(data.values[k]));

  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  };
  const num = (key: keyof SettingsValues) => (e: { target: { value: string } }) =>
    set(key, (e.target.value === '' ? '' : Number(e.target.value)) as never);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(values, changed);
    setClientErrors(found);
    if (Object.keys(found).length) return;
    save.mutate(Object.fromEntries(changed.map((k) => [k, values[k]])));
  };

  return (
    <form className="card" onSubmit={submit} noValidate>
      <FormAlert error={save.error} />
      {saved && !changed.length && <div className="alert alert-info">تم حفظ الإعدادات.</div>}

      {tab === 'company' && (
        <>
          <div className="form-grid">
            <TextField label="اسم الشركة بالعربية" value={values['company.nameAr']} onChange={(e) => set('company.nameAr', e.target.value)} error={errors['company.nameAr']} />
            <TextField label="اسم الشركة بالإنجليزية" dir="ltr" value={values['company.nameEn']} onChange={(e) => set('company.nameEn', e.target.value)} error={errors['company.nameEn']} />
          </div>
          <SelectField label="العملة الافتراضية" value={values['currency.default']} onChange={(e) => set('currency.default', e.target.value)} error={errors['currency.default']}>
            {currencies.data
              ?.filter((c) => c.status === 'ACTIVE' || c.code === values['currency.default'])
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameAr} ({c.code})
                </option>
              ))}
          </SelectField>
          <LogoField />
        </>
      )}

      {tab === 'security' && (
        <div className="form-grid">
          <TextField label="عدد محاولات الدخول الفاشلة قبل القفل" type="number" min={3} max={20} value={values['security.maxFailedAttempts']} onChange={num('security.maxFailedAttempts')} error={errors['security.maxFailedAttempts']} />
          <TextField label="مدة القفل (دقائق)" type="number" min={1} max={1440} value={values['security.lockoutMinutes']} onChange={num('security.lockoutMinutes')} error={errors['security.lockoutMinutes']} />
          <TextField label="انتهاء الجلسة عند عدم النشاط (دقائق)" type="number" min={5} max={480} value={values['security.sessionIdleMinutes']} onChange={num('security.sessionIdleMinutes')} error={errors['security.sessionIdleMinutes']} />
          <TextField label="أقصى مدة للجلسة (ساعات)" type="number" min={1} max={72} value={values['security.sessionMaxHours']} onChange={num('security.sessionMaxHours')} error={errors['security.sessionMaxHours']} />
        </div>
      )}

      {tab === 'files' && (
        <>
          <TextField label="الحد الأقصى لحجم الملف (ميغابايت)" type="number" min={1} max={100} value={values['files.maxSizeMb']} onChange={num('files.maxSizeMb')} error={errors['files.maxSizeMb']} />
          <fieldset className="group">
            <legend>أنواع الملفات المسموح بها</legend>
            <div className="check-grid">
              {data.allowableExtensions.map((ext) => (
                <label key={ext} className="check">
                  <input
                    type="checkbox"
                    checked={values['files.allowedExtensions'].includes(ext)}
                    onChange={(e) =>
                      set(
                        'files.allowedExtensions',
                        e.target.checked ? [...values['files.allowedExtensions'], ext] : values['files.allowedExtensions'].filter((x) => x !== ext),
                      )
                    }
                  />
                  <bdi dir="ltr">{ext.toUpperCase()}</bdi>
                </label>
              ))}
            </div>
            {errors['files.allowedExtensions'] && <span className="field-error">{errors['files.allowedExtensions'].join(' ')}</span>}
            <p className="hint">الأنواع التنفيذية والبرمجية غير متاحة لأسباب أمنية.</p>
          </fieldset>
        </>
      )}

      <button type="submit" className="btn btn-primary" disabled={!changed.length || save.isPending}>
        {save.isPending ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
      </button>{' '}
      {changed.length > 0 && (
        <button type="button" className="btn" onClick={() => setValues(data.values)}>
          تراجع
        </button>
      )}
    </form>
  );
}

/** Company logo used in the UI, PDFs and reports (spec §65). Saved immediately, separately from the form. */
function LogoField() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const logoId = me?.company.logoFileId ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api('/settings/logo', { method: 'POST', body });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => api('/settings/logo', { method: 'DELETE' }), onSuccess: refresh });
  return (
    <fieldset className="group">
      <legend>شعار الشركة</legend>
      <FormAlert error={upload.error ?? remove.error} />
      <div className="toolbar">
        {logoId ? <img src={fileUrl(logoId)} alt="شعار الشركة" style={{ maxBlockSize: 64, maxInlineSize: 200 }} /> : <span className="muted">لا يوجد شعار.</span>}
        <label className="btn btn-sm">
          {upload.isPending ? 'جارٍ الرفع…' : logoId ? 'تغيير الشعار' : 'رفع شعار'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
        </label>
        {logoId && (
          <button type="button" className="btn btn-sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            إزالة
          </button>
        )}
      </div>
      <p className="hint">PNG أو JPEG أو WebP. يظهر في الواجهة والمستندات الرسمية والتقارير.</p>
    </fieldset>
  );
}

function CurrenciesTab() {
  const list = useQuery({ queryKey: ['settings', 'currencies'], queryFn: () => api<Currency[]>('/settings/currencies') });
  const actions = useRecordActions('/settings/currencies', 'settings');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', nameAr: '', symbol: '' });
  const errors = fieldErrors(actions.create.error);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await actions.create.mutateAsync(form);
      setAdding(false);
      setForm({ code: '', nameAr: '', symbol: '' });
    } catch {
      // Shown in the dialog.
    }
  };

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      <div className="toolbar">
        <p className="muted grow">لا يوجد تحويل تلقائي بين العملات. العملة المعطّلة لا تظهر في النماذج الجديدة.</p>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          إضافة عملة
        </button>
      </div>
      <FormAlert error={actions.update.error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الرمز</th>
              <th>الاسم</th>
              <th>العلامة</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((c) => (
              <tr key={c.code}>
                <td>
                  <bdi dir="ltr">{c.code}</bdi>
                </td>
                <td>{c.nameAr}</td>
                <td>{c.symbol ?? '—'}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => actions.update.mutate({ id: c.code, status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                  >
                    {c.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal open title="إضافة عملة" onClose={() => { actions.create.reset(); setAdding(false); }}>
          <form onSubmit={submit}>
            <FormAlert error={actions.create.error} />
            <TextField label="رمز العملة (ISO، 3 أحرف)" dir="ltr" maxLength={3} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} error={errors.code} autoFocus />
            <TextField label="الاسم بالعربية" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} error={errors.nameAr} />
            <TextField label="العلامة (اختياري)" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} error={errors.symbol} />
            <button type="submit" className="btn btn-primary" disabled={actions.create.isPending}>
              حفظ
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

interface Sequence {
  key: string;
  label: string;
  prefix: string;
  nextValue: number;
  digits: number;
  preview: string;
}

function NumberingTab() {
  const list = useQuery({ queryKey: ['settings', 'sequences'], queryFn: () => api<Sequence[]>('/settings/sequences') });
  const [editing, setEditing] = useState<Sequence | null>(null);
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      <p className="muted">
        لكل فئة عداد مستقل، ولكل نوع عملية عداد مستقل. الأرقام لا يعاد استخدامها، لذا لا يمكن إرجاع العداد إلى رقم أقل.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>التسلسل</th>
              <th>البادئة</th>
              <th>الرقم التالي</th>
              <th>عدد الخانات</th>
              <th>معاينة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td>
                  <bdi dir="ltr">{s.prefix}</bdi>
                </td>
                <td>{s.nextValue}</td>
                <td>{s.digits}</td>
                <td>
                  <bdi dir="ltr">{s.preview}</bdi>
                </td>
                <td>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>
                    تعديل
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <SequenceDialog sequence={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SequenceDialog({ sequence, onClose }: { sequence: Sequence; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ prefix: sequence.prefix, nextValue: sequence.nextValue, digits: sequence.digits });
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: () => api<Sequence>(`/settings/sequences/${encodeURIComponent(sequence.key)}`, { method: 'PATCH', json: form }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'sequences'] });
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const preview = `${form.prefix}-${String(form.nextValue || 0).padStart(form.digits || 1, '0')}`;

  return (
    <>
      <Modal open title={`تعديل: ${sequence.label}`} onClose={onClose}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming(true);
          }}
        >
          <FormAlert error={save.error} />
          <div className="form-grid">
            <TextField label="البادئة" dir="ltr" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} error={errors.prefix} />
            <TextField label="الرقم التالي" type="number" min={sequence.nextValue} value={form.nextValue} onChange={(e) => setForm({ ...form, nextValue: Number(e.target.value) })} error={errors.nextValue} hint={`لا يقل عن ${sequence.nextValue}`} />
            <TextField label="عدد الخانات" type="number" min={1} max={12} value={form.digits} onChange={(e) => setForm({ ...form, digits: Number(e.target.value) })} error={errors.digits} />
          </div>
          <p>
            الرقم التالي سيكون: <bdi dir="ltr">{preview}</bdi>
          </p>
          <button type="submit" className="btn btn-primary">
            حفظ
          </button>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirming}
        title="تأكيد تغيير الترقيم"
        message={
          <>
            <p>
              الحالي: <bdi dir="ltr">{sequence.preview}</bdi> ← الجديد: <bdi dir="ltr">{preview}</bdi>
            </p>
            <p className="muted">الأرقام الصادرة سابقًا لا تتغير.</p>
          </>
        }
        confirmLabel="تأكيد"
        busy={save.isPending}
        error={formError(save.error)}
        onConfirm={() => save.mutate(undefined, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

interface Provider {
  id: string;
  type: 'EXTERNAL' | 'COMPANY';
  name: string;
  phone: string | null;
  notes: string | null;
  status: Status;
}

function ProvidersTab() {
  const { state, update, query } = useServerList<Provider>('/maintenance-providers', ['status'], { sort: 'name' });
  const actions = useRecordActions('/maintenance-providers');
  const [editing, setEditing] = useState<Provider | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);

  const columns: Column<Provider>[] = [
    { key: 'name', label: 'الاسم', sort: 'name', render: (p) => p.name },
    { key: 'type', label: 'النوع', sort: 'type', render: (p) => (p.type === 'COMPANY' ? 'شركة' : 'فني خارجي') },
    { key: 'phone', label: 'الهاتف', render: (p) => <bdi dir="ltr">{p.phone ?? '—'}</bdi> },
    { key: 'status', label: 'الحالة', render: (p) => <StatusBadge status={p.status} /> },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (p) => (
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>
            تعديل
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(p)}>
            حذف
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <p className="muted grow">الموظفون الفنيون يُختارون من EAP مباشرة ولا يُضافون هنا.</p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          إضافة فني أو شركة
        </button>
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(p) => p.id} empty="لا يوجد مزودو صيانة." />
      {editing && (
        <ProviderDialog
          provider={editing === 'new' ? null : editing}
          actions={actions}
          onClose={() => {
            actions.create.reset();
            actions.update.reset();
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="حذف مزود صيانة"
        message={`حذف «${deleting?.name}»؟ لا يمكن حذف من ارتبط بطلبات صيانة؛ يمكن تعطيله بدلًا من ذلك.`}
        confirmLabel="حذف"
        danger
        busy={actions.remove.isPending}
        error={formError(actions.remove.error)}
        onConfirm={() => deleting && actions.remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onClose={() => {
          actions.remove.reset();
          setDeleting(null);
        }}
      />
    </>
  );
}

function ProviderDialog({ provider, actions, onClose }: { provider: Provider | null; actions: ReturnType<typeof useRecordActions>; onClose: () => void }) {
  const [form, setForm] = useState({
    type: provider?.type ?? 'COMPANY',
    name: provider?.name ?? '',
    phone: provider?.phone ?? '',
    notes: provider?.notes ?? '',
    status: provider?.status ?? 'ACTIVE',
  });
  const mutation = provider ? actions.update : actions.create;
  const errors = fieldErrors(mutation.error);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { type, status, ...rest } = form;
    try {
      if (provider) await actions.update.mutateAsync({ id: provider.id, ...rest, status });
      else await actions.create.mutateAsync({ type, ...rest });
      onClose();
    } catch {
      // Shown below.
    }
  };
  return (
    <Modal open title={provider ? 'تعديل مزود صيانة' : 'إضافة فني أو شركة صيانة'} onClose={onClose}>
      <form onSubmit={submit}>
        <FormAlert error={mutation.error} />
        {!provider && (
          <SelectField label="النوع" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Provider['type'] })}>
            <option value="COMPANY">شركة</option>
            <option value="EXTERNAL">فني خارجي</option>
          </SelectField>
        )}
        <TextField label="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoFocus />
        <TextField label="الهاتف" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} />
        <TextField label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} error={errors.notes} />
        {provider && (
          <SelectField label="الحالة" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>
            <option value="ACTIVE">فعّال</option>
            <option value="INACTIVE">معطّل</option>
          </SelectField>
        )}
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !form.name.trim()}>
          حفظ
        </button>
      </form>
    </Modal>
  );
}

interface NotificationTypeRow {
  key: string;
  label: string;
  isEnabled: boolean;
  targetResponsible: boolean;
  roles: Array<{ id: string; name: string }>;
  users: Array<{ id: string; username: string; fullName: string }>;
}

/** Notification types, enable/disable and recipients (spec §39, §64). */
function NotificationTypesTab() {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: ['notification-types'], queryFn: () => api<NotificationTypeRow[]>('/notification-types') });
  const [editing, setEditing] = useState<NotificationTypeRow | null>(null);
  const toggle = useMutation({
    mutationFn: (t: NotificationTypeRow) => api(`/notification-types/${t.key}`, { method: 'PATCH', json: { isEnabled: !t.isEnabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-types'] }),
  });
  if (types.isPending) return <Loading />;
  if (types.isError) return <ErrorState error={types.error} onRetry={() => void types.refetch()} />;
  return (
    <>
      <p className="muted">«المسؤول المعني» هو الشخص الذي تخصه العملية، مثل المستلم الذي يجب أن يؤكد محضر العهدة.</p>
      <FormAlert error={toggle.error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>نوع الإشعار</th>
              <th>المستلمون</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.data.map((t) => {
              const recipients = [...(t.targetResponsible ? ['المسؤول المعني'] : []), ...t.roles.map((r) => r.name), ...t.users.map((u) => u.fullName)];
              return (
                <tr key={t.key}>
                  <td>{t.label}</td>
                  <td>{recipients.join('، ') || <span className="muted">لا أحد</span>}</td>
                  <td>
                    <span className={`badge ${t.isEnabled ? 'badge-success' : ''}`}>{t.isEnabled ? 'مفعّل' : 'معطّل'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => toggle.mutate(t)}>
                        {t.isEnabled ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(t)}>
                        المستلمون
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && <RecipientsDialog type={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecipientsDialog({ type, onClose }: { type: NotificationTypeRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Array<{ id: string; name: string; status: Status }>>('/roles') });
  const users = useQuery({
    queryKey: ['/users', 'all-active'],
    queryFn: () => api<{ items: Array<{ id: string; username: string; employee: { fullName: string } }> }>('/users?state=active&pageSize=250&sort=fullName'),
  });
  const [roleIds, setRoleIds] = useState(type.roles.map((r) => r.id));
  const [userIds, setUserIds] = useState(type.users.map((u) => u.id));
  const [responsible, setResponsible] = useState(type.targetResponsible);
  const save = useMutation({
    mutationFn: () => api(`/notification-types/${type.key}/recipients`, { method: 'PUT', json: { roleIds, userIds, targetResponsible: responsible } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-types'] });
      onClose();
    },
  });
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  return (
    <Modal
      open
      wide
      title={`مستلمو إشعار: ${type.label}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          حفظ
        </button>
      }
    >
      <FormAlert error={save.error} />
      <label className="check">
        <input type="checkbox" checked={responsible} onChange={(e) => setResponsible(e.target.checked)} /> المسؤول المعني بالعملية
      </label>
      <fieldset className="group" style={{ marginBlockStart: '0.75rem' }}>
        <legend>الأدوار</legend>
        <div className="check-grid">
          {roles.data?.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={roleIds.includes(r.id)} onChange={(e) => toggle(roleIds, setRoleIds, r.id, e.target.checked)} />
              {r.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="group">
        <legend>مستخدمون محددون</legend>
        <div className="check-grid">
          {users.data?.items.map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={userIds.includes(u.id)} onChange={(e) => toggle(userIds, setUserIds, u.id, e.target.checked)} />
              {u.employee.fullName}
            </label>
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}
