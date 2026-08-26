/**
 * Placeholder tags for the printed Terms & Conditions.
 * -----------------------------------------------------------------------------
 * The terms are free text edited in Settings, and every clause that mentions a
 * number used to have that number typed into it — "Payment Should Be Made
 * Within 30 Days" printed 30 days on every document regardless of what the
 * party had actually been given. A party on 7 days received a sales order
 * promising 30.
 *
 * So the terms may now carry tags, and the document fills them in from its own
 * record when it prints:
 *
 *   "Payment Should Be Made Within {{pay_terms}} Days"
 *
 * Substitution happens at RENDER time, not when the terms are saved: the same
 * saved sentence has to print differently for each party, which is the whole
 * point.
 */

/** One supported tag, and what it stands for. Also drives the Settings help. */
export interface DocTagInfo {
  tag: string;
  label: string;
}

export const DOC_TAGS: DocTagInfo[] = [
  { tag: '{{pay_terms}}', label: "The party's payment terms, in days" },
  { tag: '{{party}}', label: 'Party name' },
  { tag: '{{doc_no}}', label: 'This document’s number' },
  { tag: '{{doc_date}}', label: 'This document’s date' },
  { tag: '{{due_date}}', label: 'Due date printed on this document' },
];

/** The values a document offers. A field left undefined/null is "not known". */
export interface DocTemplateVars {
  pay_terms?: number | string | null;
  party?: string | null;
  doc_no?: string | null;
  doc_date?: string | null;
  due_date?: string | null;
}

/** Matches `{{ tag }}` with any surrounding whitespace, case-insensitively, so a
 *  line typed as `{{Pay_Terms}}` still resolves. */
const TAG_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/**
 * Fill one line's tags, or return null if it cannot be completed.
 *
 * NULL — meaning "drop this line" — is deliberate. A clause whose number is
 * unknown must not print with a hole in it: "Payment Should Be Made Within
 * Days" reads as a clerical error on a document a customer may hold you to, and
 * guessing a default would state a term nobody agreed. Omitting the clause is
 * the only honest option, so an unresolvable tag removes its own line.
 *
 * A line with no tags at all always survives untouched — the vast majority of
 * terms, and they must be unaffected by any of this.
 */
export function renderDocLine(line: string, vars: DocTemplateVars): string | null {
  if (!TAG_RE.test(line)) {
    TAG_RE.lastIndex = 0;
    return line;
  }
  TAG_RE.lastIndex = 0;

  let unresolved = false;
  const out = line.replace(TAG_RE, (_whole, rawName: string) => {
    const key = rawName.toLowerCase() as keyof DocTemplateVars;
    const value = vars[key];
    // An unknown tag name is left as the author typed it: it is far more likely
    // to be a typo they want to see and fix than a tag we should silently eat.
    if (!(key in vars)) return _whole as string;
    if (value === null || value === undefined || value === '') {
      unresolved = true;
      return '';
    }
    return String(value);
  });

  if (unresolved) return null;
  // Substitution can leave doubled spaces where a tag sat between words.
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Fill a whole terms list, dropping any line whose tags cannot be resolved. */
export function renderDocLines(lines: string[], vars: DocTemplateVars): string[] {
  return lines.map((l) => renderDocLine(l, vars)).filter((l): l is string => l !== null && l.trim() !== '');
}
