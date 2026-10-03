/** Quick sign-in PIN: exactly four digits. */
export const QUICK_PIN_PATTERN = /^\d{4}$/;

/** PINs anyone would try first: one digit repeated, or a run up or down (1234, 8901, 4321…). */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const up = d.every((v, i) => i === 0 || v === (d[i - 1] + 1) % 10);
  const down = d.every((v, i) => i === 0 || v === (d[i - 1] + 9) % 10);
  return up || down;
}
