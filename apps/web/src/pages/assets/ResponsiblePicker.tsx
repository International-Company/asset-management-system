import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Responsible } from './types';

interface DirectoryEntry {
  eapEmployeeId: string;
  fullName: string;
  jobTitle: string | null;
  isActive: boolean;
}
interface ExternalEntry {
  id: string;
  name: string;
  organization: string | null;
}

/**
 * Picks a responsible person: an EAP employee or a registered external
 * person. Free-text names are impossible by design (spec §13). Inactive
 * employees are shown but cannot be chosen (spec §46).
 */
export function ResponsiblePicker({
  value,
  onChange,
  error,
  legend = 'المسؤول *',
}: {
  legend?: string;
  value: Responsible | null;
  onChange: (r: Responsible | null) => void;
  error?: string[];
}) {
  const [type, setType] = useState<'EMPLOYEE' | 'EXTERNAL'>(value?.type ?? 'EMPLOYEE');
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const searchId = useId();

  const employees = useQuery({
    queryKey: ['employees', 'directory', submitted],
    enabled: type === 'EMPLOYEE' && submitted.length > 0,
    queryFn: () => api<DirectoryEntry[]>(`/employees/directory?q=${encodeURIComponent(submitted)}`),
  });
  // External people are listed immediately (a short, local list) and narrowed by search.
  const externals = useQuery({
    queryKey: ['lookups', 'external-people', submitted],
    enabled: type === 'EXTERNAL',
    queryFn: () => api<ExternalEntry[]>(`/lookups/external-people?q=${encodeURIComponent(submitted)}`),
  });
  const results = type === 'EMPLOYEE' ? employees : externals;

  return (
    <fieldset className="group" aria-describedby={error?.length ? `${searchId}-error` : undefined}>
      <legend>{legend}</legend>
      {value ? (
        <p>
          <strong>{value.label}</strong> <span className="muted">({value.type === 'EMPLOYEE' ? 'موظف' : 'شخص خارجي'})</span>{' '}
          <button type="button" className="btn-link" onClick={() => onChange(null)}>
            تغيير
          </button>
        </p>
      ) : (
        <>
          <div className="toolbar" role="radiogroup" aria-label="نوع المسؤول">
            {(['EMPLOYEE', 'EXTERNAL'] as const).map((t) => (
              <label key={t} className="check">
                <input
                  type="radio"
                  name={`${searchId}-type`}
                  checked={type === t}
                  onChange={() => {
                    setType(t);
                    setSubmitted('');
                    setTerm('');
                  }}
                />
                {t === 'EMPLOYEE' ? 'موظف (EAP)' : 'شخص خارجي مسجل'}
              </label>
            ))}
          </div>
          <div className="toolbar">
            <div className="field grow">
              <label htmlFor={searchId}>{type === 'EMPLOYEE' ? 'ابحث عن موظف' : 'ابحث عن شخص خارجي'}</label>
              <input
                id={searchId}
                className="input"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setSubmitted(term.trim());
                  }
                }}
              />
            </div>
            <button type="button" className="btn" onClick={() => setSubmitted(term.trim())}>
              بحث
            </button>
          </div>
          {results.isFetching && <p className="muted">جارٍ البحث…</p>}
          {results.data && results.data.length === 0 && <p className="muted">لا توجد نتائج.</p>}
          {results.data && results.data.length > 0 && (
            <ul className="pick-list">
              {type === 'EMPLOYEE'
                ? employees.data?.map((e) => (
                    <li key={e.eapEmployeeId}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={!e.isActive}
                        onClick={() => onChange({ type: 'EMPLOYEE', eapEmployeeId: e.eapEmployeeId, label: e.fullName })}
                      >
                        اختيار
                      </button>
                      <span>
                        {e.fullName} <span className="muted">{e.jobTitle ?? ''}</span>
                        {!e.isActive && <span className="badge badge-warning">غير فعّال</span>}
                      </span>
                    </li>
                  ))
                : externals.data?.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="btn btn-sm" onClick={() => onChange({ type: 'EXTERNAL', externalPersonId: p.id, label: p.name })}>
                        اختيار
                      </button>
                      <span>
                        {p.name} <span className="muted">{p.organization ?? ''}</span>
                      </span>
                    </li>
                  ))}
            </ul>
          )}
        </>
      )}
      {error?.length ? (
        <span id={`${searchId}-error`} className="field-error">
          {error.join(' ')}
        </span>
      ) : null}
    </fieldset>
  );
}
