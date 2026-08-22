/**
 * The base item name — "{size} {product}" with any trailing design / handle /
 * logo suffix dropped — e.g. "10 RDX WL+TOOL+LOGO" (product "RDX") → "10 RDX",
 * and "7 DECENT TOOL" (product "DECENT") → "7 DECENT".
 *
 * This is the legacy Form13 SelectProduct value: the base-name pickers on
 * Dispatch Order and Order Modify group every design variant of an item under
 * one entry, which is what keeps those lists short enough to type into (869
 * full names collapse to 235 bases on this data).
 *
 * We cut the name right after the product word rather than stripping the
 * `designType` token: on this data designType is "NA"/null on ~80% of lines
 * even when the name carries a design suffix, so a design-based strip left the
 * suffix on and the "base" list still showed full, design-laden names.
 */
export function baseProductName(full: string | null | undefined, product: string | null | undefined): string {
  const name = (full ?? '').trim();
  const prod = (product ?? '').trim();
  if (!prod) return name;
  const idx = name.toUpperCase().indexOf(prod.toUpperCase());
  if (idx === -1) return name; // product word not found in the name → leave as-is
  return name.slice(0, idx + prod.length).trim();
}

/**
 * Does a line's item name answer to `target`?
 *
 * `base` off → the picker listed full names, so only that exact item matches.
 * `base` on  → the picker listed base names, so the base itself AND all its
 * design variants match: "12 MALBORO" brings in "12 MALBORO DL+LOGO" too. The
 * trailing space is what stops "12 JET" from swallowing "12 JETSTAR".
 */
export function matchesProductName(full: string | null | undefined, target: string, base?: boolean): boolean {
  const name = (full ?? '').trim();
  return name === target || (!!base && name.startsWith(`${target} `));
}
