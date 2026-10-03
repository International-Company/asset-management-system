import { useEffect, useRef, useState } from 'react';

/**
 * Four PIN boxes. One real input sits over them (numeric keypad on phones,
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Back in the boxes after a failed attempt, ready for the next try.
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);
  return (
    <div className="pin" data-invalid={invalid || undefined}>
      <input
        ref={ref}
        id={id}
        className="pin-input"
        aria-label={label}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={4}
        dir="ltr"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 4);
          onChange(next);
          if (next.length === 4) onComplete?.(next);
        }}
      />
      <div className="pin-boxes" aria-hidden="true" dir="ltr">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="pin-box" data-filled={i < value.length || undefined} data-current={(focused && i === Math.min(value.length, 3)) || undefined} />
        ))}
      </div>
    </div>
  );
}
