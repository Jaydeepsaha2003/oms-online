import type { OrderItemOption } from '@oms/shared';

const fmtNum = (v: number | null) => (v == null ? '' : String(v));

/**
 * The New Order item-name list, shared with Booking Dispatch: each entry is
 * "{size|pcs} {product} {designType}". The leading number is the product's size
 * in "Size" mode or its pcs in "Pcs" mode.
 *
 * `query` is what has been typed so far. A leading number in it — the "8" in
 * "8 borosil" — labels each row by whichever of its measures that number
 * matches, so a number that is a SIZE for one item and a PCS for another still
 * lists both: "8" → "8 BOROSIL CUP" (size 8) AND "8 BOROSIL SPECIAL" (pcs 8).
 */
export function buildItemOptions(
  list: readonly OrderItemOption[],
  showBy: 'PCS' | 'SIZE',
  query: string,
  skip: (it: OrderItemOption) => boolean = () => false,
) {
  const lead = query.trim().match(/^(\d+(?:\.\d+)?)/)?.[1] ?? '';
  const map = new Map<string, OrderItemOption>();
  const options: { value: string; label: string; keywords: string }[] = [];
  for (const it of list) {
    if (skip(it)) continue;
    const sizeStr = fmtNum(it.size);
    const pcsStr = fmtNum(it.pcs);
    let prefix = showBy === 'PCS' ? pcsStr : sizeStr;
    if (lead) {
      // Prefer an exact hit; while still mid-number, a prefix hit. Size wins a
      // tie so a plain "8" on an 8-size / 8-pcs item reads as its size.
      if (sizeStr === lead) prefix = sizeStr;
      else if (pcsStr === lead) prefix = pcsStr;
      else if (sizeStr.startsWith(lead)) prefix = sizeStr;
      else if (pcsStr.startsWith(lead)) prefix = pcsStr;
    }
    const label = [prefix, it.product, it.designType ?? ''].filter(Boolean).join(' ');
    if (!label || map.has(label)) continue; // first wins on duplicate labels
    map.set(label, it);
    // Search-only tokens: BOTH size and pcs (whichever isn't the visible
    // prefix) plus the sub-category — so a Size-view row like "5.5 RAJWADI" is
    // still found by typing "15" (its pcs / "15-PCS" sub-category), and a
    // Pcs-view row is found by its size.
    const keywords = [sizeStr, pcsStr, it.subCategory ?? ''].filter(Boolean).join(' ');
    options.push({ value: label, label, keywords });
  }
  return { options, map };
}
