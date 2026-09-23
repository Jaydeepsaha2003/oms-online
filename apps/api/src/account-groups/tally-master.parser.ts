import { gstStateFromGstin, type TallyLedgerDetails } from '@oms/shared';

export interface TallyMasterEntry {
  name: string;
  /** null = Primary. */
  parent: string | null;
  details?: TallyLedgerDetails;
}

export interface TallyMaster {
  groups: TallyMasterEntry[];
  ledgers: TallyMasterEntry[];
}

/** Tally writes XML as UTF-16 LE (with or without a BOM) or UTF-8. */
function decode(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const probe = buf.subarray(0, 200);
  let zeros = 0;
  for (let i = 1; i < probe.length; i += 2) if (probe[i] === 0) zeros++;
  if (probe.length > 10 && zeros > probe.length / 4) return buf.toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

function text(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(body: string, ...names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<${n.replace('.', '\\.')}(?:\\s[^>]*)?>([\\s\\S]*?)</${n.replace('.', '\\.')}>`, 'i').exec(body);
    const v = m ? text(m[1]) : '';
    if (v) return v;
  }
  return null;
}

function allTags(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => text(m[1])).filter(Boolean);
}

function cityFromAddress(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const withoutPin = lines[i]
      .replace(/\b\d{6}\b/g, '')
      .replace(/\bINDIA\b/gi, '')
      .replace(/[\s,.;:/\\-]+$/g, '')
      .trim();
    const candidate = withoutPin.split(',').at(-1)?.trim() ?? '';
    if (candidate && candidate.length <= 50 && !/\d/.test(candidate)) return candidate;
  }
  return null;
}

function detailsOf(body: string): TallyLedgerDetails {
  // BILLCREDITPERIOD also holds bill dates ("2-Mar-21") inside bill-wise openings; only "45 Days" is the ledger's own.
  const credit = allTags(body, 'BILLCREDITPERIOD').map((v) => /^(\d+)\s*days?$/i.exec(v)).find(Boolean);
  const address = allTags(body, 'ADDRESS');
  const gstin = tag(body, 'PARTYGSTIN', 'GSTIN');
  return {
    creditPeriod: credit ? Number(credit[1]) : null,
    state: tag(body, 'STATE', 'LEDSTATENAME', 'PRIORSTATENAME', 'OLDLEDSTATENAME') ?? gstStateFromGstin(gstin),
    city: tag(body, 'CITY', 'LEDGERCITY') ?? cityFromAddress(address),
    mobile: tag(body, 'LEDGERMOBILE', 'LEDGERPHONE'),
    email: tag(body, 'EMAIL'),
    gstin,
    transportName: tag(body, 'TRANSPORTNAME', 'TRANSPORTERNAME', 'CARRIERNAME'),
  };
}

function parentOf(body: string): string | null {
  const m = /<PARENT(?:\s[^>]*)?>([\s\S]*?)<\/PARENT>/i.exec(body);
  const p = m ? text(m[1]) : '';
  return !p || /^primary$/i.test(p) ? null : p;
}

export function parseTallyMaster(buf: Buffer): TallyMaster {
  const xml = decode(buf);
  if (!/<ENVELOPE[\s>]/i.test(xml) || !/<TALLYMESSAGE[\s>]/i.test(xml)) {
    throw new Error('This is not a Tally XML export. In Tally use Export → Masters with format XML (Data Interchange).');
  }
  const out: TallyMaster = { groups: [], ledgers: [] };
  const seen = { GROUP: new Set<string>(), LEDGER: new Set<string>() };
  const re = /<(GROUP|LEDGER)\s(?:[^>]*?\s)?NAME="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const kind = m[1].toUpperCase() as 'GROUP' | 'LEDGER';
    const name = text(m[2]);
    if (!name || seen[kind].has(name)) continue;
    seen[kind].add(name);
    const body = m[3] ?? '';
    if (kind === 'GROUP') out.groups.push({ name, parent: parentOf(body) });
    else out.ledgers.push({ name, parent: parentOf(body), details: detailsOf(body) });
  }
  if (!out.ledgers.length && !out.groups.length) throw new Error('No groups or ledgers found in this file.');
  return out;
}
