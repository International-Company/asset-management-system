import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { ApiError } from '../lib/api';

/** Field-level messages from a failed API call (ApiError.fields), keyed by field name. */
export function fieldErrors(error: unknown): Record<string, string[]> {
  return error instanceof ApiError && error.fields ? error.fields : {};
}

/** The general error message to show above a form, if any. */
export function formError(error: unknown): string | null {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع.';
}

interface FieldProps {
  label: string;
  error?: string[];
  hint?: string;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error?.length ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(error?.length ? { 'aria-invalid': true } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) })}
      {hint && !error?.length && (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      )}
      {error?.length ? (
        <span id={`${id}-error`} className="field-error">
          {error.join(' ')}
        </span>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string[]; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(a11y) => <input className="input" {...a11y} {...input} />}
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  children,
  ...select
}: { label: string; error?: string[]; hint?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(a11y) => (
        <select className="input" {...a11y} {...select}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function FormAlert({ error }: { error: unknown }) {
  const message = formError(error);
  return message ? (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  ) : null;
}

export function StatusBadge({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  return <span className={`badge ${status === 'ACTIVE' ? 'badge-success' : ''}`}>{status === 'ACTIVE' ? 'فعّال' : 'معطّل'}</span>;
}
