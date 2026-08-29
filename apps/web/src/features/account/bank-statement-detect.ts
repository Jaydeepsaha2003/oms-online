import type { BankAccountDto } from '@oms/shared';

/**
 * Working out which of OUR bank accounts a statement belongs to.
 *
 * Nothing here knows the name of a single bank. Every signal is matched against
 * the accounts the user has actually configured, so a statement from a bank
 * nobody has seen before is recognised the moment its account exists in the
 * app — no code change, no list to maintain.
 *
 * The evidence lives in two places: the block of account details a statement
 * carries above its column titles, and the file name, which for most exports is
 * built from the account number (`AcctStatement_XXX8254_27082026.csv`).
 */

type Account = Pick<BankAccountDto, 'bankName' | 'acNo' | 'ifsc'>;

/** How the match was made, so the page can say why it chose what it chose. */
export type BankMatchReason = 'account number' | 'IFSC' | 'last digits of the account' | 'bank name';

export interface BankMatch {
  bankName: string;
  reason: BankMatchReason;
}

const squash = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Digit runs of 4 or more — an account number, masked or whole. */
const digitRuns = (v: string) => v.match(/\d{4,}/g) ?? [];

/**
 * The account this statement is for, or null when the evidence does not point
 * at exactly one.
 *
 * Ambiguity returns null on purpose. Reconciling money into the wrong ledger is
 * far worse than asking, and the field stays empty and required either way — so
 * a guess buys nothing and can cost a lot.
 */
export function detectBankAccount(text: string, accounts: Account[]): BankMatch | null {
  const usable = accounts.filter((a) => a.bankName?.trim());
  if (!usable.length || !text.trim()) return null;

  const flat = squash(text);
  const runs = digitRuns(text);

  /** Exactly one account satisfies `hit` → that is the answer. */
  const only = (hit: (a: Account) => boolean, reason: BankMatchReason): BankMatch | null => {
    const found = usable.filter(hit);
    const names = new Set(found.map((a) => a.bankName.trim()));
    // Two ROWS of the same bank are not ambiguous — the field holds a name.
    return names.size === 1 ? { bankName: found[0].bankName.trim(), reason } : null;
  };

  // 1. The whole account number, however it was punctuated.
  const byAcNo = only((a) => {
    const ac = squash(a.acNo ?? '');
    return ac.length >= 6 && flat.includes(ac);
  }, 'account number');
  if (byAcNo) return byAcNo;

  // 2. IFSC — unique to a branch, so it cannot point at two banks.
  const byIfsc = only((a) => {
    const ifsc = squash(a.ifsc ?? '');
    return ifsc.length >= 8 && flat.includes(ifsc);
  }, 'IFSC');
  if (byIfsc) return byIfsc;

  // 3. A masked number: the file name and the header block usually keep the
  //    last few digits ("XXX8254"). Matched as a SUFFIX so 8254 does not match
  //    an account that merely contains those digits in the middle.
  const byTail = only((a) => {
    const ac = squash(a.acNo ?? '');
    if (ac.length < 4) return false;
    return runs.some((run) => run.length >= 4 && (ac.endsWith(run) || run.endsWith(ac.slice(-Math.min(6, ac.length)))));
  }, 'last digits of the account');
  if (byTail) return byTail;

  // 4. Last resort: the bank's own name in the text. Weakest signal — a
  //    narration line naming another bank could trip it — so it only counts
  //    when exactly one configured bank is named.
  const byName = only((a) => {
    const name = squash(a.bankName);
    return name.length >= 3 && flat.includes(name);
  }, 'bank name');
  return byName;
}

/**
 * Everything worth searching for the account: the file name plus the block of
 * detail above the column titles. Rows BELOW the titles are transactions —
 * their narrations name other people's banks and would mislead.
 */
export function statementIdentityText(fileName: string, grid: string[][], headerRow: number): string {
  const preamble = grid.slice(0, Math.max(headerRow, 0));
  return [fileName, ...preamble.map((row) => row.join(' '))].join('\n');
}
