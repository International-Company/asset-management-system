import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Date field: type the date (2026/09/30, 30/09/2026, Arabic digits too) or
 * pick it from the calendar. The value is always ISO "YYYY-MM-DD" (or "" when
 * empty), exactly like a native date input, so forms and the API don't change.
 * Month names follow Palestinian usage; the week starts on Saturday.
 */

export const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
/** Saturday first. */
const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const WEEKDAY_SHORT = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];

interface Ymd {
  y: number;
  m: number; // 0-11
  d: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = ({ y, m, d }: Ymd) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** 0 = Saturday … 6 = Friday. */
const weekdayIndex = ({ y, m, d }: Ymd) => (new Date(Date.UTC(y, m, d)).getUTCDay() + 1) % 7;
const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;

function fromIso(iso: string | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const v = { y: +m[1], m: +m[2] - 1, d: +m[3] };
  return v.m >= 0 && v.m < 12 && v.d >= 1 && v.d <= daysIn(v.y, v.m) ? v : null;
}

function addDays(v: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(v.y, v.m, v.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

function addMonths(v: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(v.y, v.m + n, 1));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  return { y, m, d: Math.min(v.d, daysIn(y, m)) };
}

function today(): Ymd {
  // The company's calendar day (spec: Asia/Hebron), not the browser's.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hebron', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return fromIso(parts)!;
}

/** "2026/09/30" as shown in the field (same order as dates elsewhere in the app). */
export const formatYmd = (v: Ymd) => `${v.y}/${pad(v.m + 1)}/${pad(v.d)}`;

/**
 * Parses what was typed. Returns an ISO date, "" for an empty field, or
 * undefined while the text is not (yet) a valid date.
 */
export function parseTyped(raw: string): string | undefined {
  const text = raw.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).trim();
  if (!text) return '';
  let v: Ymd | null = null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) v = { y: +m[1], m: +m[2] - 1, d: +m[3] };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) v = { y: +m[3], m: +m[2] - 1, d: +m[1] };
  if (!v || v.y < 1900 || v.y > 2200 || v.m < 0 || v.m > 11 || v.d < 1 || v.d > daysIn(v.y, v.m)) return undefined;
  return toIso(v);
}

type View = 'days' | 'months' | 'years';

export interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
/** Points to the reading start (right in RTL): "previous". */
const PrevIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const NextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export function DatePicker({ id, value, onChange, min, max, disabled, ...aria }: DatePickerProps) {
  const selected = fromIso(value);
  const minD = fromIso(min);
  const maxD = fromIso(max);
  const [text, setText] = useState(selected ? formatYmd(selected) : '');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('days');
  const [focus, setFocus] = useState<Ymd>(selected ?? today());
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const titleId = useId();

  // Follow value changes from outside (reset, URL filters), but never overwrite
  // what is being typed: our own emissions are remembered and skipped.
  const [emitted, setEmitted] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (value !== emitted) setText(selected ? formatYmd(selected) : '');
  }
  const emit = (iso: string) => {
    setEmitted(iso);
    onChange(iso);
  };

  const outOfRange = (v: Ymd) => (minD && cmp(v, minD) < 0) || (maxD && cmp(v, maxD) > 0);
  const invalid = text !== '' && parseTyped(text) === undefined;

  const openAt = (v: Ymd) => {
    setFocus(v);
    setView('days');
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) input.current?.focus();
  };
  const choose = (v: Ymd) => {
    if (outOfRange(v)) return;
    setText(formatYmd(v));
    emit(toIso(v));
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // Keep keyboard focus on the focused day while navigating the grid.
  const [gridHasFocus, setGridHasFocus] = useState(false);
  useEffect(() => {
    if (open && view === 'days' && gridHasFocus) grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [focus, open, view, gridHasFocus]);

  const weeks = useMemo(() => {
    const first: Ymd = { y: focus.y, m: focus.m, d: 1 };
    const start = addDays(first, -weekdayIndex(first));
    return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  }, [focus.y, focus.m]);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => Ymd> = {
      // Right-to-left: the left arrow moves forward in time.
      ArrowLeft: () => addDays(focus, 1),
      ArrowRight: () => addDays(focus, -1),
      ArrowDown: () => addDays(focus, 7),
      ArrowUp: () => addDays(focus, -7),
      Home: () => addDays(focus, -weekdayIndex(focus)),
      End: () => addDays(focus, 6 - weekdayIndex(focus)),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setFocus(moves[e.key]());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(focus);
    }
  };

  const t = today();
  const decade = Math.floor(focus.y / 12) * 12;

  return (
    <div className="datefield" ref={root} data-open={open}>
      <input
        ref={input}
        id={id}
        className="input datefield-input"
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder="سنة/شهر/يوم"
        value={text}
        disabled={disabled}
        data-invalid={invalid || undefined}
        {...aria}
        aria-invalid={aria['aria-invalid'] ?? (invalid ? true : undefined)}
        onChange={(e) => {
          setText(e.target.value);
          // Until the text is a whole valid date the value is empty, never a
          // half-typed date (2026/02/3 on the way to an impossible 2026/02/30).
          const iso = parseTyped(e.target.value) ?? '';
          if (iso !== emitted) emit(iso);
        }}
        onBlur={() => {
          const iso = parseTyped(text);
          if (iso) setText(formatYmd(fromIso(iso)!));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && (e.altKey || !open)) {
            e.preventDefault();
            openAt(selected ?? t);
            setGridHasFocus(true);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            close(false);
          }
        }}
      />
      <span className="datefield-actions">
        {text && !disabled && (
          <button
            type="button"
            className="datefield-btn datefield-clear"
            aria-label="مسح التاريخ"
            onClick={() => {
              setText('');
              emit('');
              input.current?.focus();
            }}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="datefield-btn"
          aria-label="فتح التقويم"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popupId}
          disabled={disabled}
          onClick={() => (open ? close(false) : (openAt(selected ?? t), setGridHasFocus(true)))}
        >
          <CalendarIcon />
        </button>
      </span>

      {open && (
        <div
          id={popupId}
          className="datepicker"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="dp-head">
            <button
              type="button"
              className="dp-nav"
              aria-label={view === 'days' ? 'الشهر السابق' : view === 'months' ? 'السنة السابقة' : 'السنوات السابقة'}
              onClick={() => setFocus(view === 'days' ? addMonths(focus, -1) : view === 'months' ? addMonths(focus, -12) : addMonths(focus, -144))}
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              id={titleId}
              className="dp-title"
              aria-live="polite"
              onClick={() => setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days')}
            >
              {view === 'days' ? `${MONTHS[focus.m]} ${focus.y}` : view === 'months' ? String(focus.y) : `${decade} – ${decade + 11}`}
            </button>
            <button
              type="button"
              className="dp-nav"
              aria-label={view === 'days' ? 'الشهر التالي' : view === 'months' ? 'السنة التالية' : 'السنوات التالية'}
              onClick={() => setFocus(view === 'days' ? addMonths(focus, 1) : view === 'months' ? addMonths(focus, 12) : addMonths(focus, 144))}
            >
              <NextIcon />
            </button>
          </div>

          {view === 'days' && (
            <div ref={grid} className="dp-grid" role="grid" aria-labelledby={titleId} onKeyDown={onGridKey} onFocus={() => setGridHasFocus(true)}>
              <div className="dp-row dp-weekdays" role="row">
                {WEEKDAY_SHORT.map((w, i) => (
                  <span key={w} role="columnheader" aria-label={WEEKDAYS[i]} className="dp-weekday">
                    {w}
                  </span>
                ))}
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} className="dp-row" role="row">
                  {week.map((day) => {
                    const isFocus = cmp(day, focus) === 0;
                    const isSel = !!selected && cmp(day, selected) === 0;
                    const disabledDay = !!outOfRange(day);
                    return (
                      <span key={toIso(day)} role="gridcell" aria-selected={isSel}>
                        <button
                          type="button"
                          className="dp-day"
                          tabIndex={isFocus ? 0 : -1}
                          data-outside={day.m !== focus.m || undefined}
                          data-today={cmp(day, t) === 0 || undefined}
                          data-selected={isSel || undefined}
                          disabled={disabledDay}
                          aria-label={`${WEEKDAYS[weekdayIndex(day)]} ${day.d} ${MONTHS[day.m]} ${day.y}`}
                          aria-current={cmp(day, t) === 0 ? 'date' : undefined}
                          onClick={() => choose(day)}
                        >
                          {day.d}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {view === 'months' && (
            <div className="dp-picks" role="listbox" aria-label="اختر الشهر">
              {MONTHS.map((name, m) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={m === focus.m}
                  className="dp-pick"
                  data-selected={m === focus.m || undefined}
                  onClick={() => {
                    setFocus({ y: focus.y, m, d: Math.min(focus.d, daysIn(focus.y, m)) });
                    setView('days');
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {view === 'years' && (
            <div className="dp-picks" role="listbox" aria-label="اختر السنة">
              {Array.from({ length: 12 }, (_, i) => decade + i).map((y) => (
                <button
                  key={y}
                  type="button"
                  role="option"
                  aria-selected={y === focus.y}
                  className="dp-pick"
                  data-selected={y === focus.y || undefined}
                  data-today={y === t.y || undefined}
                  onClick={() => {
                    setFocus({ y, m: focus.m, d: Math.min(focus.d, daysIn(y, focus.m)) });
                    setView('months');
                  }}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          <div className="dp-foot">
            <button type="button" className="btn-link" disabled={!!outOfRange(t)} onClick={() => choose(t)}>
              اليوم
            </button>
            {value && (
              <button
                type="button"
                className="btn-link dp-clear"
                onClick={() => {
                  setText('');
                  emit('');
                  close(true);
                }}
              >
                مسح
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
