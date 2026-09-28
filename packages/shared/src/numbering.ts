/** Formats a sequence value, e.g. formatNumber('TEC', 12, 6) → "TEC-000012". */
export function formatNumber(prefix: string, value: number, digits: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Invalid sequence value: ${value}`);
  }
  return `${prefix}-${String(value).padStart(digits, '0')}`;
}
