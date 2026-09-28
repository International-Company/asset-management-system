import { type ReactNode, useEffect, useState } from 'react';
import { SelectField, TextField } from './Form';

/**
 * A form value mirrored into the URL. The field shows its local value at
 * once (URL updates run inside a React transition and would otherwise lag a
 * click or keystroke) and pushes it to the URL — after `debounceMs` for text.
 * Changes that arrive from the URL itself (applying a saved search, clearing
 * filters) replace the local value, but the echo of our own push does not.
 */
function useUrlValue(url: string, push: (v: string) => void, debounceMs: number): [string, (v: string) => void] {
  const [local, setLocal] = useState(url);
  const [seen, setSeen] = useState(url);
  const [pushed, setPushed] = useState<string | null>(null);
  if (url !== seen) {
    setSeen(url);
    if (url !== pushed) setLocal(url);
  }
  useEffect(() => {
    if (local === url) return;
    const t = setTimeout(() => {
      setPushed(local);
      push(local);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [local, url, push, debounceMs]);
  return [local, setLocal];
}

interface Bound {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

export function UrlTextField({ label, value, onChange, type }: Bound & { type?: 'text' | 'date' }) {
  const [local, setLocal] = useUrlValue(value, onChange, type === 'date' ? 0 : 350);
  return <TextField label={label} type={type} value={local} onChange={(e) => setLocal(e.target.value)} />;
}

export function UrlSelectField({ label, value, onChange, children }: Bound & { children: ReactNode }) {
  const [local, setLocal] = useUrlValue(value, onChange, 0);
  return (
    <SelectField label={label} value={local} onChange={(e) => setLocal(e.target.value)}>
      {children}
    </SelectField>
  );
}

/** A set of checkboxes stored as a comma-separated URL value. */
export function UrlCheckboxGroup({ label, value, onChange, options }: Bound & { options: Array<[string, string]> }) {
  const [local, setLocal] = useUrlValue(value, onChange, 0);
  const selected = local ? local.split(',') : [];
  const toggle = (v: string, on: boolean) => setLocal((on ? [...selected, v] : selected.filter((x) => x !== v)).join(','));
  return (
    <div className="check-grid" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <label key={v} className="check">
          <input type="checkbox" checked={selected.includes(v)} onChange={(e) => toggle(v, e.target.checked)} />
          {l}
        </label>
      ))}
    </div>
  );
}
