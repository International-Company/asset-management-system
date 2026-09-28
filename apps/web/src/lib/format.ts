const dateTime = new Intl.DateTimeFormat('ar', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Hebron',
  numberingSystem: 'latn',
});

/** Formats an ISO timestamp in the company timezone (spec: Asia/Hebron). */
export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

/**
 * Wraps a value in Unicode isolation marks (FSI…PDI) so Latin text such as
 * "Dell" cannot flip the direction of the surrounding Arabic, e.g. in
 * "old ← new" change descriptions.
 */
export function isolate(value: unknown): string {
  return `\u2068${String(value)}\u2069`;
}
