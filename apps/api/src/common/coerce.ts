/** Small value-coercion helpers shared by the data modules. */

export function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function uc(v: unknown): string | null {
  const s = toStr(v);
  return s ? s.toUpperCase() : null;
}

export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n == null ? null : Math.round(n);
}
