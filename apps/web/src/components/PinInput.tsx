import { useEffect, useRef, useState } from 'react';

/**
 * PIN boxes (four by default). One real input sits over them (numeric keypad on phones,
 * paste and screen readers work as usual); the boxes only show progress.
 */
export function PinInput({
  id,
  label,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  invalid,
  length = 4,
  secret = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  length?: number;
  /** Hide the digits (PINs) or show them (one-time codes). */
  secret?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Back in the boxes after a failed attempt, ready for the next try.
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);
  return (
    <div className="pin" data-length={length} data-invalid={invalid || undefined}>
      <input
        ref={ref}
        id={id}
        className="pin-input"
        aria-label={label}
        type={secret ? 'password' : 'text'}
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={length}
        dir="ltr"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
      />
      <div className="pin-boxes" aria-hidden="true" dir="ltr">
        {Array.from({ length }, (_, i) => (
          <span key={i} className="pin-box" data-filled={(secret && i < value.length) || undefined} data-current={(focused && i === Math.min(value.length, length - 1)) || undefined}>
            {secret ? null : value[i]}
          </span>
        ))}
      </div>
    </div>
  );
}
