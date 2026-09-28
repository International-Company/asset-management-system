import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAIN_CATEGORY_LABELS, type MainCategoryCode } from '@osooli/shared';
import { api } from '../../lib/api';
import { ASSET_FIELD_LABELS } from '../../lib/labels';
import { fieldErrors, FormAlert, SelectField, TextField } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { ResponsiblePicker } from './ResponsiblePicker';
import type { AssetDetail, CategoryLookup, CurrencyLookup, LocationLookup, Responsible } from './types';

const TECH_KEYS = ['manufacturer', 'model', 'macAddress', 'ipAddress', 'operatingSystem', 'specifications'] as const;
const REA_KEYS = ['propertyType', 'propertyName', 'locationText', 'area', 'propertyNumber', 'parcelNumber', 'ownershipDeed', 'ownershipDate', 'ownershipNotes'] as const;

export interface AssetFormValues {
  name: string;
  mainCategory: MainCategoryCode | '';
  subcategoryId: string;
  serialNumber: string;
  locationId: string;
  departmentId: string;
  responsible: Responsible | null;
  notes: string;
  purchase: { date: string; supplier: string; invoiceNumber: string; value: string; currency: string };
  warranty: { exists: boolean; expiresAt: string; details: string };
  technical: Record<(typeof TECH_KEYS)[number], string>;
  realEstate: Record<(typeof REA_KEYS)[number], string>;
}

const empty = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, ''])) as Record<K, string>;
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

export function valuesFromAsset(a?: AssetDetail): AssetFormValues {
  return {
    name: a?.name ?? '',
    mainCategory: a?.mainCategory ?? '',
    subcategoryId: a?.subcategory.id ?? '',
    serialNumber: '',
    locationId: a?.locationDepartment.location.id ?? '',
    departmentId: a?.locationDepartment.department.id ?? '',
    responsible: null,
    notes: a?.notes ?? '',
    purchase: {
      date: day(a?.purchaseDate),
      supplier: a?.supplier ?? '',
      invoiceNumber: a?.invoiceNumber ?? '',
      value: a?.purchaseValue ?? '',
      currency: a?.purchaseCurrency ?? '',
    },
    warranty: { exists: a?.warrantyExists ?? false, expiresAt: day(a?.warrantyExpiresAt), details: a?.warrantyDetails ?? '' },
    technical: a?.technical ? (Object.fromEntries(TECH_KEYS.map((k) => [k, a.technical![k] ?? ''])) as AssetFormValues['technical']) : empty(TECH_KEYS),
    realEstate: a?.realEstate
      ? (Object.fromEntries(REA_KEYS.map((k) => [k, k === 'ownershipDate' ? day(a.realEstate![k]) : (a.realEstate![k] ?? '')])) as AssetFormValues['realEstate'])
      : empty(REA_KEYS),
  };
}

/** Client-side checks mirroring the server (spec §71); the server re-validates everything. */
function validate(v: AssetFormValues, mode: 'create' | 'edit'): Record<string, string[]> {
  const e: Record<string, string[]> = {};
  if (!v.name.trim()) e.name = ['هذا الحقل مطلوب.'];
  if (mode === 'create') {
    if (!v.subcategoryId) e.subcategoryId = ['اختر الفئة الفرعية.'];
    if (!v.locationId) e.locationId = ['اختر الموقع.'];
    if (!v.departmentId) e.departmentId = ['اختر القسم.'];
    if (!v.responsible) e.responsible = ['اختر المسؤول.'];
  }
  if (v.purchase.value && !/^\d{1,16}(\.\d{1,2})?$/.test(v.purchase.value)) e['purchase.value'] = ['رقم موجب بحد أقصى منزلتين عشريتين.'];
  if (v.purchase.value && !v.purchase.currency) e['purchase.currency'] = ['حدد عملة قيمة الشراء.'];
  if (v.mainCategory === 'TEC') {
    if (v.technical.macAddress && !/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(v.technical.macAddress)) e['technical.macAddress'] = ['عنوان MAC غير صالح.'];
    if (v.technical.ipAddress && !/^(\d{1,3}\.){3}\d{1,3}$|:/.test(v.technical.ipAddress)) e['technical.ipAddress'] = ['عنوان IP غير صالح.'];
  }
  if (v.mainCategory === 'REA' && v.realEstate.area && !/^\d{1,12}(\.\d{1,2})?$/.test(v.realEstate.area)) e['realEstate.area'] = ['رقم موجب بحد أقصى منزلتين عشريتين.'];
  return e;
}

/** Request body for create or edit. Empty strings are sent as-is; the API turns them into null. */
function payload(v: AssetFormValues, mode: 'create' | 'edit') {
  const common = {
    name: v.name.trim(),
    notes: v.notes,
    purchase: v.purchase,
    warranty: v.warranty,
    ...(v.mainCategory === 'TEC' ? { technical: v.technical } : {}),
    ...(v.mainCategory === 'REA' ? { realEstate: v.realEstate } : {}),
  };
  if (mode === 'edit') return common;
  const r = v.responsible!;
  return {
    ...common,
    subcategoryId: v.subcategoryId,
    serialNumber: v.serialNumber,
    locationId: v.locationId,
    departmentId: v.departmentId,
    responsible: r.type === 'EMPLOYEE' ? { type: r.type, eapEmployeeId: r.eapEmployeeId } : { type: r.type, externalPersonId: r.externalPersonId },
  };
}

/** Flattened editable values, for the "old → new" review (spec §20). */
function flatten(v: AssetFormValues): Record<string, string> {
  const out: Record<string, string> = { name: v.name.trim(), notes: v.notes.trim() };
  for (const [k, x] of Object.entries(v.purchase)) out[`purchase.${k}`] = x.trim();
  out['warranty.exists'] = v.warranty.exists ? 'نعم' : 'لا';
  out['warranty.expiresAt'] = v.warranty.exists ? v.warranty.expiresAt : '';
  out['warranty.details'] = v.warranty.exists ? v.warranty.details.trim() : '';
  if (v.mainCategory === 'TEC') for (const [k, x] of Object.entries(v.technical)) out[`technical.${k}`] = x.trim();
  if (v.mainCategory === 'REA') for (const [k, x] of Object.entries(v.realEstate)) out[`realEstate.${k}`] = x.trim();
  return out;
}

export function AssetForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  pending,
  error,
}: {
  mode: 'create' | 'edit';
  initial: AssetFormValues;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
  error: unknown;
}) {
  const [v, setV] = useState<AssetFormValues>(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>({});
  const [reviewing, setReviewing] = useState<Array<{ field: string; old: string; new: string }> | null>(null);
  const categories = useQuery({ queryKey: ['lookups', 'categories'], queryFn: () => api<CategoryLookup[]>('/lookups/categories') });
  const locations = useQuery({ queryKey: ['lookups', 'locations'], queryFn: () => api<LocationLookup[]>('/lookups/locations') });
  const currencies = useQuery({ queryKey: ['lookups', 'currencies'], queryFn: () => api<CurrencyLookup[]>('/lookups/currencies') });
  const errors = { ...fieldErrors(error), ...clientErrors };

  const set = <K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) => setV((s) => ({ ...s, [key]: value }));
  const setIn = <K extends 'purchase' | 'warranty' | 'technical' | 'realEstate'>(group: K, key: keyof AssetFormValues[K], value: unknown) =>
    setV((s) => ({ ...s, [group]: { ...s[group], [key]: value } }));
  const text = (group: 'purchase' | 'technical' | 'realEstate', key: string) => ({
    value: (v[group] as Record<string, string>)[key],
    onChange: (e: { target: { value: string } }) => setIn(group, key as never, e.target.value),
    error: errors[`${group}.${key}`],
  });

  const subs = categories.data?.find((c) => c.code === v.mainCategory)?.subcategories ?? [];
  const departments = locations.data?.find((l) => l.id === v.locationId)?.departments ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(v, mode);
    setClientErrors(found);
    if (Object.keys(found).length) return;
    if (mode === 'edit') {
      const before = flatten(initial);
      const after = flatten(v);
      const changes = Object.keys(after)
        .filter((k) => (before[k] ?? '') !== after[k])
        .map((k) => ({ field: k, old: before[k] ?? '', new: after[k] }));
      setReviewing(changes);
      return;
    }
    onSubmit(payload(v, mode));
  };

  return (
    <form onSubmit={submit} noValidate>
      <FormAlert error={error} />
      {Object.keys(clientErrors).length > 0 && (
        <div className="alert alert-error" role="alert">
          يرجى مراجعة الحقول المحددة.
        </div>
      )}

      <section className="card">
        <h2>البيانات الأساسية</h2>
        <TextField label="اسم الأصل *" value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={200} error={errors.name} />
        {mode === 'create' && (
          <>
            <div className="form-grid">
              <SelectField
                label="الفئة الرئيسية *"
                value={v.mainCategory}
                onChange={(e) => setV((s) => ({ ...s, mainCategory: e.target.value as MainCategoryCode, subcategoryId: '' }))}
              >
                <option value="">اختر…</option>
                {categories.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {MAIN_CATEGORY_LABELS[c.code]} ({c.code})
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="الفئة الفرعية *"
                value={v.subcategoryId}
                disabled={!v.mainCategory}
                onChange={(e) => set('subcategoryId', e.target.value)}
                error={errors.subcategoryId}
              >
                <option value="">اختر…</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            </div>
            <TextField
              label="الرقم التسلسلي"
              dir="ltr"
              value={v.serialNumber}
              onChange={(e) => set('serialNumber', e.target.value)}
              maxLength={100}
              hint="اتركه فارغًا إذا لم يوفر المصنع رقمًا؛ سيُولَّد رقم داخلي INT-SN ويمكن استبداله لاحقًا."
              error={errors.serialNumber}
            />
            <div className="form-grid">
              <SelectField
                label="الموقع *"
                value={v.locationId}
                onChange={(e) => setV((s) => ({ ...s, locationId: e.target.value, departmentId: '' }))}
                error={errors.locationId}
              >
                <option value="">اختر…</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="القسم *"
                value={v.departmentId}
                disabled={!v.locationId}
                onChange={(e) => set('departmentId', e.target.value)}
                error={errors.departmentId}
                hint={v.locationId && departments.length === 0 ? 'لا توجد أقسام مسجلة في هذا الموقع.' : undefined}
              >
                <option value="">اختر…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectField>
            </div>
            <ResponsiblePicker
              value={v.responsible}
              onChange={(r) => set('responsible', r)}
              error={errors.responsible ?? errors['responsible.eapEmployeeId'] ?? errors['responsible.externalPersonId']}
            />
            <p className="hint">حالة الأصل الجديد تكون «جديد» تلقائيًا.</p>
          </>
        )}
        <div className="field">
          <label htmlFor="asset-notes">ملاحظات</label>
          <textarea id="asset-notes" className="input" value={v.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </section>

      {v.mainCategory === 'TEC' && (
        <section className="card">
          <h2>البيانات التقنية</h2>
          <div className="form-grid">
            <TextField label="الشركة المصنعة" {...text('technical', 'manufacturer')} />
            <TextField label="الطراز" {...text('technical', 'model')} />
            <TextField label="عنوان MAC" dir="ltr" placeholder="00:1A:2B:3C:4D:5E" {...text('technical', 'macAddress')} />
            <TextField label="عنوان IP" dir="ltr" {...text('technical', 'ipAddress')} />
            <TextField label="نظام التشغيل" {...text('technical', 'operatingSystem')} />
          </div>
          <div className="field">
            <label htmlFor="tech-specs">المواصفات</label>
            <textarea id="tech-specs" className="input" value={v.technical.specifications} onChange={(e) => setIn('technical', 'specifications', e.target.value)} />
          </div>
        </section>
      )}

      {v.mainCategory === 'REA' && (
        <section className="card">
          <h2>البيانات العقارية</h2>
          <div className="form-grid">
            <TextField label="نوع العقار" {...text('realEstate', 'propertyType')} />
            <TextField label="اسم / وصف العقار" {...text('realEstate', 'propertyName')} />
            <TextField label="موقع العقار" {...text('realEstate', 'locationText')} />
            <TextField label="المساحة (م²)" dir="ltr" inputMode="decimal" {...text('realEstate', 'area')} />
            <TextField label="رقم العقار" {...text('realEstate', 'propertyNumber')} />
            <TextField label="رقم القطعة" {...text('realEstate', 'parcelNumber')} />
            <TextField label="سند الملكية" {...text('realEstate', 'ownershipDeed')} />
            <TextField label="تاريخ الملكية" type="date" {...text('realEstate', 'ownershipDate')} />
          </div>
          <div className="field">
            <label htmlFor="rea-notes">ملاحظات الملكية</label>
            <textarea id="rea-notes" className="input" value={v.realEstate.ownershipNotes} onChange={(e) => setIn('realEstate', 'ownershipNotes', e.target.value)} />
          </div>
        </section>
      )}

      <section className="card">
        <h2>بيانات الشراء (اختيارية)</h2>
        <div className="form-grid">
          <TextField label="تاريخ الشراء" type="date" {...text('purchase', 'date')} />
          <TextField label="المورد" {...text('purchase', 'supplier')} />
          <TextField label="رقم الفاتورة" dir="ltr" {...text('purchase', 'invoiceNumber')} />
          <TextField label="قيمة الشراء" dir="ltr" inputMode="decimal" {...text('purchase', 'value')} />
          <SelectField label="العملة" value={v.purchase.currency} onChange={(e) => setIn('purchase', 'currency', e.target.value)} error={errors['purchase.currency']}>
            <option value="">—</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameAr} ({c.code})
              </option>
            ))}
          </SelectField>
        </div>
        <p className="hint">لا يتم تحويل العملات تلقائيًا.</p>
      </section>

      <section className="card">
        <h2>الضمان</h2>
        <label className="check">
          <input type="checkbox" checked={v.warranty.exists} onChange={(e) => setIn('warranty', 'exists', e.target.checked)} />
          يوجد ضمان
        </label>
        {v.warranty.exists && (
          <div className="form-grid" style={{ marginBlockStart: '0.75rem' }}>
            <TextField label="تاريخ انتهاء الضمان" type="date" value={v.warranty.expiresAt} onChange={(e) => setIn('warranty', 'expiresAt', e.target.value)} error={errors['warranty.expiresAt']} />
            <TextField label="تفاصيل الضمان" value={v.warranty.details} onChange={(e) => setIn('warranty', 'details', e.target.value)} error={errors['warranty.details']} />
          </div>
        )}
      </section>

      <p>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'جارٍ الحفظ…' : submitLabel}
        </button>
      </p>

      {reviewing && (
        <Modal
          open
          wide
          title="مراجعة التغييرات قبل الحفظ"
          onClose={() => setReviewing(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || reviewing.length === 0}
                onClick={() => {
                  setReviewing(null);
                  onSubmit(payload(v, mode));
                }}
              >
                تأكيد الحفظ
              </button>
              <button type="button" className="btn" onClick={() => setReviewing(null)}>
                رجوع للتعديل
              </button>
            </>
          }
        >
          {reviewing.length === 0 ? (
            <p className="muted">لم تغيّر أي حقل.</p>
          ) : (
            <table className="diff">
              <thead>
                <tr>
                  <th>الحقل</th>
                  <th>القيمة القديمة</th>
                  <th>القيمة الجديدة</th>
                </tr>
              </thead>
              <tbody>
                {reviewing.map((c) => (
                  <tr key={c.field}>
                    <td>{ASSET_FIELD_LABELS[c.field] ?? c.field}</td>
                    <td className="old">{c.old || '—'}</td>
                    <td className="new">{c.new || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </form>
  );
}
