/** Money + number formatting shared across the dashboard analytics widgets. */

export const inrFull = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Compact Indian money: ₹1.25Cr / ₹3.4L / ₹12.5K. Full value belongs in a tooltip. */
export function inrCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const trim = (v: number) => v.toFixed(v < 10 ? 2 : 1).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Compact plain count: 12.5K / 3.4L (for bags / kgs / pcs). */
export function numCompact(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number) => v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, '');
  if (abs >= 1e5) return `${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${trim(abs / 1e3)}K`;
  return `${Math.round(abs).toLocaleString('en-IN')}`;
}
