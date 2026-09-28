/** Keys whose values must never be written to logs, audit or security records (spec §48, §75). */
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|fingerprint|biometric|encryption|credential|assertion/i;

// qr_token is an asset identifier, not a credential.
const ALLOWED_KEYS = new Set(['qrToken', 'qr_token']);

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) && !ALLOWED_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out as T;
}

/** Converts values Prisma returns (Decimal, BigInt, Date) into JSON-safe values. */
export function toJsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}
