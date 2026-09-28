import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { MAIN_CATEGORY_LABELS, PERMISSIONS, type MainCategoryCode } from '@osooli/shared';
import { api, ApiError, downloadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fieldErrors, FormAlert, SelectField, TextField } from '../../components/Form';
import { SavedSearchBar } from '../../components/SavedSearches';
import { Empty, ErrorState, Loading } from '../../components/States';
import type { LocationLookup } from '../assets/types';

type Cell = string | number | null;
interface ReportFilter {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'location' | 'department' | 'category';
  options?: Array<[string, string]>;
}
interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money';
}
interface ReportInfo {
  key: string;
  title: string;
  description: string;
  filters: ReportFilter[];
  columns: ReportColumn[];
}
interface Preview {
  columns: ReportColumn[];
  rows: Array<Record<string, Cell>>;
  total: number;
  truncated: boolean;
  summary?: Array<{ label: string; value: string }>;
}

const catalogueQuery = { queryKey: ['reports'], queryFn: () => api<ReportInfo[]>('/reports') };

/** Reports module (spec §40). */
export function ReportsPage() {
  const reports = useQuery(catalogueQuery);
  return (
    <>
      <div className="page-header">
        <div>
          <h1>التقارير</h1>
          <p className="muted">كل تصدير إلى PDF أو Excel يُسجَّل في سجل التدقيق.</p>
        </div>
      </div>
      {reports.isPending ? (
        <Loading />
      ) : reports.isError ? (
        <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
      ) : (
        <nav className="section-links" aria-label="التقارير">
          {reports.data.map((r) => (
            <Link key={r.key} to={`/reports/${r.key}`}>
              {r.title}
              <small>{r.description}</small>
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

function formatCell(v: Cell, type?: string) {
  if (v === null || v === '') return '—';
  if (typeof v === 'number') {
    const text = type === 'money' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString('en-US');
    return <bdi dir="ltr">{text}</bdi>;
  }
  return v;
}

export function ReportPage() {
  const { key } = useParams<{ key: string }>();
  const { can } = useAuth();
  const reports = useQuery(catalogueQuery);
  const locations = useQuery({ queryKey: ['lookups', 'locations'], queryFn: () => api<LocationLookup[]>('/lookups/locations') });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const preview = useMutation({ mutationFn: (f: Record<string, string>) => api<Preview>(`/reports/${key}/preview`, { method: 'POST', json: { filters: f } }) });

  if (reports.isPending) return <Loading />;
  if (reports.isError) return <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />;
  const report = reports.data.find((r) => r.key === key);
  if (!report) {
    return (
      <div className="card">
        <h1>التقرير غير متاح</h1>
        <Link to="/reports">العودة إلى التقارير</Link>
      </div>
    );
  }
  const departments = [...new Map((locations.data ?? []).flatMap((l) => l.departments).map((d) => [d.id, d])).values()];
  const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const errors = fieldErrors(preview.error);
  const run = (f = active) => preview.mutate(f);

  const exportAs = async (format: 'pdf' | 'xlsx') => {
    setExporting(format);
    setExportError(null);
    try {
      await downloadFile(`/reports/${key}/export`, { filters: active, format });
    } catch (e) {
      setExportError(e instanceof ApiError ? e : new Error('تعذر التصدير.'));
    } finally {
      setExporting(null);
    }
  };

  const input = (f: ReportFilter) => {
    const common = { label: f.label, value: filters[f.key] ?? '', onChange: (e: { target: { value: string } }) => setFilters((s) => ({ ...s, [f.key]: e.target.value })), error: errors[f.key] };
    if (f.type === 'date') return <TextField key={f.key} type="date" {...common} />;
    if (f.type === 'text') return <TextField key={f.key} {...common} />;
    const options: Array<[string, string]> =
      f.type === 'select'
        ? (f.options ?? [])
        : f.type === 'location'
          ? (locations.data ?? []).map((l) => [l.id, l.name])
          : f.type === 'department'
            ? departments.map((d) => [d.id, d.name])
            : (Object.keys(MAIN_CATEGORY_LABELS) as MainCategoryCode[]).map((c) => [c, MAIN_CATEGORY_LABELS[c]]);
    return (
      <SelectField key={f.key} {...common}>
        <option value="">الكل</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
    );
  };

  return (
    <>
      <p className="muted">
        <Link to="/reports">التقارير</Link> / {report.title}
      </p>
      <div className="page-header">
        <div>
          <h1>{report.title}</h1>
          <p className="muted">{report.description}</p>
        </div>
        {can(PERMISSIONS.REPORTS_EXPORT) && (
          <div className="row-actions">
            <button type="button" className="btn" disabled={!!exporting} onClick={() => void exportAs('pdf')}>
              {exporting === 'pdf' ? 'جارٍ التصدير…' : 'تصدير PDF'}
            </button>
            <button type="button" className="btn" disabled={!!exporting} onClick={() => void exportAs('xlsx')}>
              {exporting === 'xlsx' ? 'جارٍ التصدير…' : 'تصدير Excel'}
            </button>
          </div>
        )}
      </div>
      <FormAlert error={exportError} />

      <section className="card">
        <h2>الفلاتر</h2>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          {report.filters.length > 0 ? <div className="form-grid">{report.filters.map(input)}</div> : <p className="muted">لا توجد فلاتر لهذا التقرير.</p>}
          <button type="submit" className="btn btn-primary" disabled={preview.isPending}>
            {preview.isPending ? 'جارٍ التحميل…' : 'عرض التقرير'}
          </button>{' '}
          {Object.keys(active).length > 0 && (
            <button type="button" className="btn" onClick={() => setFilters({})}>
              مسح الفلاتر
            </button>
          )}
        </form>
        <SavedSearchBar
          scope={`report:${report.key}`}
          current={{ filters: active }}
          onApply={(saved) => {
            setFilters(saved.filters);
            run(saved.filters);
          }}
        />
      </section>

      <FormAlert error={preview.isError && !Object.keys(errors).length ? preview.error : null} />
      {preview.data && (
        <section className="card">
          <p className="muted">
            {preview.data.truncated ? `معاينة أول ${preview.data.rows.length} من ${preview.data.total} سجل؛ التصدير يشمل الكل.` : `عدد السجلات: ${preview.data.total}`}
          </p>
          {preview.data.summary?.map((s) => (
            <p key={s.label}>
              <strong>{s.label}:</strong> <bdi dir="ltr">{s.value}</bdi>
            </p>
          ))}
          {preview.data.rows.length === 0 ? (
            <Empty>لا توجد بيانات مطابقة.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {preview.data.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.rows.map((r, i) => (
                    <tr key={i}>
                      {preview.data!.columns.map((c) => (
                        <td key={c.key}>{formatCell(r[c.key] ?? null, c.type)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
