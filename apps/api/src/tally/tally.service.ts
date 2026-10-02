import { createSocket } from 'node:dgram';
import { connect } from 'node:net';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { TallyCompany, TallyConfig, TallyState, TallyStatus } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { decode, tag } from '../account-groups/tally-master.parser';
import { magicPacket } from './tally-wake';

const CONFIG_KEY = 'TALLY_CONFIG';
const START_KEY = 'TALLY_START_REQUEST';
const MAC_KEY = 'TALLY_PC_MAC';
const DEFAULT_CONFIG: TallyConfig = { url: 'http://192.168.0.245:9000', companyGuid: null, gstLockDate: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A read-only Collection export. `tdl` is inline TDL — nothing is installed in Tally. */
const exportEnvelope = (id: string, tdl: string, statics = '') =>
  '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>' +
  `<ID>${id}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${statics}</STATICVARIABLES>` +
  `<TDL><TDLMESSAGE>${tdl}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

/**
 * Open companies, Name + GUID only. FETCH is always an explicit list: a `*`
 * fetch on Company returns every field, including the company's private
 * signing key (DOCUMENTKEY), and Tally's port has no password.
 */
const COMPANIES_XML = exportEnvelope('OmsCompanies', '<COLLECTION NAME="OmsCompanies"><TYPE>Company</TYPE><FETCH>Name,GUID,StateName,AltVchId</FETCH></COLLECTION>');

const STATE_MESSAGES: Record<Exclude<TallyState, 'OK' | 'OFFLINE'>, string> = {
  NO_COMPANY: 'Tally is running but no company is open. Open S.S.STEEL in Tally.',
  WRONG_COMPANY: 'The locked company is not open in Tally.',
  NOT_LOCKED: 'Lock OMS to your company in the Tally Sync Center first.',
};

/** A failed fetch, in words the person at the Tally PC can act on. */
function offlineReason(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  // The Tally PC's firewall silently drops rather than refuses, so "PC off",
  // "Tally closed" and "Tally stuck on a dialog" all look like this.
  if (err.name === 'TimeoutError') return 'Tally did not answer. Check that the Tally PC is on, TallyPrime is open, and no message box is waiting on its screen.';
  const code = err.cause?.code;
  if (code === 'ECONNREFUSED') return 'The Tally PC refused the connection. Is TallyPrime open, with "Act as Server" on port 9000?';
  if (code === 'EHOSTUNREACH' || code === 'ETIMEDOUT' || code === 'ENETUNREACH') return 'The Tally PC is not reachable. Is it switched on and on the same network?';
  if (code === 'ENOTFOUND') return 'The Tally address could not be found. Check the address below.';
  return err.message ?? 'Unknown error talking to Tally.';
}

/** The one door to TallyPrime. Every Tally call goes through `request`. */
@Injectable()
export class TallyService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<TallyConfig> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
    try {
      return { ...DEFAULT_CONFIG, ...(row ? (JSON.parse(row.value) as Partial<TallyConfig>) : {}) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  /** "Start Tally" pressed in OMS: the Tally PC's script (tally-pc) picks this up on its next poll (every ~20 s). */
  async requestStart(): Promise<void> {
    const value = String(Date.now());
    await this.prisma.appConfig.upsert({ where: { key: START_KEY }, update: { value }, create: { key: START_KEY, value } });
  }

  /** True once per request, and only if it is fresh: a PC that was off for hours must not start Tally on a stale click. */
  async takeStart(): Promise<boolean> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: START_KEY } });
    if (!row) return false;
    await this.prisma.appConfig.deleteMany({ where: { key: START_KEY } });
    return Date.now() - Number(row.value) < 10 * 60_000;
  }

  async saveConfig(input: TallyConfig): Promise<TallyConfig> {
    const value = JSON.stringify({
      url: input.url.trim().replace(/\/+$/, ''),
      companyGuid: input.companyGuid?.trim() || null,
      gstLockDate: /^\d{4}-\d{2}-\d{2}$/.test(input.gstLockDate ?? '') ? input.gstLockDate : null,
    });
    await this.prisma.appConfig.upsert({ where: { key: CONFIG_KEY }, update: { value }, create: { key: CONFIG_KEY, value } });
    return this.getConfig();
  }

  /** The Tally PC's network card address, reported by the PC's own script (pc-hello). Needed to wake it. */
  async savePcMac(mac: string | undefined | null): Promise<void> {
    if (!mac || !/^([0-9a-f]{2}[-:]?){5}[0-9a-f]{2}$/i.test(mac)) return;
    const value = mac.replace(/[^0-9a-f]/gi, '').toUpperCase();
    await this.prisma.appConfig.upsert({ where: { key: MAC_KEY }, update: { value }, create: { key: MAC_KEY, value } });
  }

  /** Wake-on-LAN: the magic packet goes out as a broadcast on the LAN (ports 9 and 7). False = no MAC known yet. */
  async wake(): Promise<boolean> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: MAC_KEY } });
    if (!row) return false;
    const packet = magicPacket(row.value);
    const host = new URL((await this.getConfig()).url).hostname;
    const targets = ['255.255.255.255', ...(/^\d+\.\d+\.\d+\.\d+$/.test(host) ? [host.replace(/\.\d+$/, '.255')] : [])];
    const sock = createSocket('udp4');
    try {
      await new Promise<void>((ok, bad) => { sock.once('error', bad); sock.bind(0, () => { sock.setBroadcast(true); ok(); }); });
      for (const t of targets) for (const port of [9, 7]) await new Promise<void>((ok) => sock.send(packet, port, t, () => ok()));
    } finally {
      sock.close();
    }
    return true;
  }

  /** The Tally PC from outside: 'up' = port answers; 'awake' = refuses (PC on, Tally closed); 'silent' = no answer at all (asleep, off, or moved). */
  private async probe(): Promise<'up' | 'awake' | 'silent'> {
    const u = new URL((await this.getConfig()).url);
    return new Promise((done) => {
      const s = connect({ host: u.hostname, port: Number(u.port || 80), timeout: 3000 });
      s.once('connect', () => { s.destroy(); done('up'); });
      s.once('timeout', () => { s.destroy(); done('silent'); });
      s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'awake' : 'silent'));
    });
  }

  /**
   * Before something is WRITTEN to Tally (a bill, a note) or Tally is asked to start: if the Tally PC is silent, wake it and wait
   * (up to 90 s in all, packet repeated every ~20 s) until it answers. Never for the 15-second status check or background reads,
   * or the PC would never sleep. A PC that is on but has Tally closed refuses at once, so nothing is woken for that.
   */
  async wakeIfAsleep(maxWaitMs = 90_000): Promise<void> {
    if ((await this.probe()) !== 'silent') return;
    if (!(await this.wake())) return;
    const until = Date.now() + maxWaitMs;
    let lastPacket = Date.now();
    while (Date.now() < until) {
      await sleep(2000);
      if ((await this.probe()) !== 'silent') return; // the url is re-read: the PC's own hello may have given it a new address
      if (Date.now() - lastPacket > 20_000) { await this.wake(); lastPacket = Date.now(); }
    }
  }

  /** POST one XML envelope to Tally; returns the reply text. HTTP 200 only means Tally answered. */
  async request(xml: string, timeoutMs = 10_000): Promise<string> {
    const { url } = await this.getConfig();
    const res = await fetch(url, {
      method: 'POST',
      body: xml,
      headers: { 'Content-Type': 'text/xml;charset=utf-8' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Tally replied HTTP ${res.status}.`);
    return decode(Buffer.from(await res.arrayBuffer()));
  }

  async status(): Promise<TallyStatus> {
    const config = await this.getConfig();
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    let reply: string;
    try {
      reply = await this.request(COMPANIES_XML, 5_000);
    } catch (e) {
      return { config, state: 'OFFLINE', ms: null, companies: [], error: offlineReason(e), checkedAt };
    }
    const ms = Date.now() - started;
    const companies: TallyCompany[] = [...reply.matchAll(/<COMPANY NAME="[^"]*"[^>]*>([^]*?)<\/COMPANY>/g)].map((m) => ({
      name: tag(m[1], 'NAME') ?? '',
      guid: tag(m[1], 'GUID') ?? '',
      state: tag(m[1], 'STATENAME'),
      altVchId: Number(tag(m[1], 'ALTVCHID') ?? 0) || null,
    }));
    const state: TallyState = !companies.length
      ? 'NO_COMPANY'
      : !config.companyGuid
        ? 'NOT_LOCKED'
        : companies.some((c) => c.guid === config.companyGuid)
          ? 'OK'
          : 'WRONG_COMPANY';
    return { config, state, ms, companies, error: null, checkedAt };
  }

  /**
   * WRITE: import one <VOUCHER> into the locked company. The reply is returned
   * raw — deciding what happened is the caller's job, and HTTP 200 decides nothing.
   */
  async importVoucher(voucherXml: string, company: TallyCompany): Promise<{ requestXml: string; responseXml: string }> {
    const requestXml =
      '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>' +
      `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(company.name)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
      `<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    return { requestXml, responseXml: await this.request(requestXml, 30_000) };
  }

  /** The locked company, open in Tally right now — or a plain-language refusal. */
  async lockedCompany(): Promise<TallyCompany> {
    const s = await this.status();
    if (s.state === 'OFFLINE') throw new ServiceUnavailableException(s.error);
    if (s.state !== 'OK') throw new ServiceUnavailableException(STATE_MESSAGES[s.state]);
    return s.companies.find((c) => c.guid === s.config.companyGuid)!;
  }

  /**
   * A read from the LOCKED company only. Refuses unless that exact company (by
   * GUID) is open, and pins the request to it by name — with two companies open,
   * an unpinned request reads whichever one Tally has current.
   */
  async exportFromCompany(id: string, tdl: string, statics = '', timeoutMs = 30_000): Promise<string> {
    const company = await this.lockedCompany();
    return this.request(exportEnvelope(id, tdl, `<SVCURRENTCOMPANY>${xmlEscape(company.name)}</SVCURRENTCOMPANY>${statics}`), timeoutMs);
  }
}
