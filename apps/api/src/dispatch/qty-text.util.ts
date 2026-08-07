/** "3 bags · 160 kgs" — only the units that carry a value, so the text stays
 *  readable. Shared by the audit trail and the dispatch alerts so the two can
 *  never describe the same shipment differently. */
export function qtyText(q: {
  bags?: number | null;
  pcs?: number | null;
  gram?: number | null;
  box?: number | null;
}): string {
  const parts = [
    q.bags ? `${q.bags} bags` : null,
    q.pcs ? `${q.pcs} pcs` : null,
    q.gram ? `${q.gram} kgs` : null,
    q.box ? `${q.box} box` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no quantities';
}
