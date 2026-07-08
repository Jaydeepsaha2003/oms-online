/**
 * MS Access → OMS connector (Settings → Data Import).
 *
 * Access stays a live parallel data source, so this isn't a one-time
 * migration tool — a manual upload persists the file (see
 * access-import.constants.ts) and every server start re-syncs from it
 * automatically (see onApplicationBootstrap below), insert-only: once a
 * legacy row is in OMS, later syncs never update or delete it.
 *
 * Flow: the .accdb is exported to JSON via the Windows ACE OLEDB provider
 * (spawned PowerShell — read-only on the file), then imported in-process with the
 * shared PrismaService (no second DB connection, so no SQLite lock contention).
 */
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ACCESS_IMPORT_FILE_PATH,
  APP_CONFIG_FILE_PATH_KEY,
  APP_CONFIG_LAST_SYNC_KEY,
  ensureAccessImportDir,
} from './access-import.constants';
import { PrismaService } from '../prisma/prisma.service';

const TABLES = [
  'CUSTOMER', 'PRODUCT', 'DESIGN', 'DESIGNNAME', 'COMBINATION', 'TRANSPORTER', 'CUSTOMER GST RATE', 'TRANS RATE', 'PRICECAL',
  'SPRODUCT', 'SCSPRODUCT', 'SCPRODUCT', 'SDESIGN', 'SCSDESIGN', 'SCDESIGN', 'SP_CATEGORY_LOGO', 'SP_SUBCATEGORY_LOGO',
  'ORDERTBL', 'DispatchTbl', 'InvTbl', 'ChallanTbl',
  // Accounts subledger (receipts, advances, ledger, opening balances, discounts) + credit notes.
  'ACCT PAYMENT RECEIPT', 'ACCT PARTY ADVANCE', 'ACCT LEDGER', 'ACCT OPENING TRANS', 'ACCT OPENING BALANCE', 'ACCT PARTY DISCOUNT',
  'InvTblR', 'ChallanTblR',
];

/** PowerShell exporter: reads each table via ACE and writes <name>.json to OutDir. */
const EXPORT_PS = `param([string]$DbPath,[string]$OutDir)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tables=@(${TABLES.map((t) => `'${t}'`).join(',')})
$conn=$null
foreach($p in @('Microsoft.ACE.OLEDB.16.0','Microsoft.ACE.OLEDB.12.0')){
  try { $c=New-Object System.Data.OleDb.OleDbConnection ("Provider=$p;Data Source=$DbPath;Persist Security Info=False;"); $c.Open(); $conn=$c; break } catch {}
}
if(-not $conn){ throw 'Could not open the Access file. Is the Microsoft Access Database Engine (ACE) installed?' }
foreach($t in $tables){
  $safe=($t -replace '[^A-Za-z0-9]','_')
  $rows=New-Object System.Collections.ArrayList
  try {
    $cmd=$conn.CreateCommand(); $cmd.CommandText="SELECT * FROM [$t]"
    $r=$cmd.ExecuteReader()
    while($r.Read()){
      $o=[ordered]@{}
      for($i=0;$i -lt $r.FieldCount;$i++){
        $n=$r.GetName($i)
        if($r.IsDBNull($i)){ $o[$n]=$null; continue }
        $v=$r.GetValue($i)
        if($v -is [datetime]){ $o[$n]=$v.ToString('o') } elseif($v -is [string]){ $o[$n]=$v.Trim() } else { $o[$n]=$v }
      }
      [void]$rows.Add([pscustomobject]$o)
    }
    $r.Close()
  } catch {
    # Table not present in this database — write an empty set and keep going.
  }
  $json=if($rows.Count -eq 0){'[]'}else{ConvertTo-Json -InputObject $rows -Depth 6}
  [System.IO.File]::WriteAllText((Join-Path $OutDir ($safe+'.json')),$json,[System.Text.UTF8Encoding]::new($false))
}
$conn.Close()
`;

type Section = 'masters' | 'pricecal' | 'agents' | 'special' | 'orders' | 'dispatch' | 'challans' | 'accounts';
interface Counts { [label: string]: number }

const s = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const up = (v: unknown): string | null => {
  const t = s(v);
  return t ? t.toUpperCase() : null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const dt = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

@Injectable()
export class AccessImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fires once the app has finished initializing. Never awaited from here on
   *  purpose — a large Access file must never delay the server actually
   *  starting to listen for requests. */
  onApplicationBootstrap(): void {
    this.runStartupSync().catch((err) => this.logger.warn(`Startup Access sync failed: ${(err as Error).message}`));
  }

  private async runStartupSync(): Promise<void> {
    if (process.platform !== 'win32') return;
    const row = await this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_FILE_PATH_KEY } });
    if (!row?.value || !existsSync(row.value)) return;

    this.logger.log(`Running startup Access sync from ${row.value}`);
    const buffer = readFileSync(row.value);
    const file = { buffer, originalname: 'source.accdb' } as Express.Multer.File;
    const result = await this.run(file, [], false);
    await this.prisma.appConfig.upsert({
      where: { key: APP_CONFIG_LAST_SYNC_KEY },
      create: { key: APP_CONFIG_LAST_SYNC_KEY, value: JSON.stringify({ at: new Date().toISOString(), results: result.results }) },
      update: { value: JSON.stringify({ at: new Date().toISOString(), results: result.results }) },
    });
    this.logger.log(`Startup Access sync complete: ${JSON.stringify(result.results)}`);
  }

  async status() {
    const [fileRow, syncRow] = await Promise.all([
      this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_FILE_PATH_KEY } }),
      this.prisma.appConfig.findUnique({ where: { key: APP_CONFIG_LAST_SYNC_KEY } }),
    ]);
    return {
      supported: process.platform === 'win32',
      platform: process.platform,
      hasPersistedFile: !!fileRow?.value && existsSync(fileRow.value),
      lastSync: syncRow?.value ? JSON.parse(syncRow.value) : null,
    };
  }

  /** Save the upload, export via ACE, import the requested sections, clean up. */
  async run(file: Express.Multer.File | undefined, sections: Section[], dry: boolean) {
    if (process.platform !== 'win32') {
      throw new BadRequestException('Data import runs only on the Windows host where the MS Access engine is installed.');
    }
    if (!file?.buffer?.length) throw new BadRequestException('No .accdb file was uploaded.');

    const work = mkdtempSync(join(tmpdir(), 'oms-access-'));
    const dbPath = join(work, 'source.accdb');
    const outDir = join(work, 'json');
    try {
      writeFileSync(dbPath, file.buffer);
      await this.export(dbPath, outDir);
      const J = (name: string): any[] => JSON.parse(readFileSync(join(outDir, name + '.json'), 'utf8'));
      const results: { section: string; counts: Counts }[] = [];
      const run = (name: Section) => sections.length === 0 || sections.includes(name);

      if (run('masters')) results.push({ section: 'Masters', counts: await this.importMasters(J, dry) });
      if (run('pricecal')) results.push({ section: 'Price-calc', counts: await this.importPriceCal(J, dry) });
      if (run('agents')) results.push({ section: 'Agents', counts: await this.importAgents(J, dry) });
      if (run('special')) results.push({ section: 'Special rates', counts: await this.importSpecial(J, dry) });
      if (run('orders')) results.push({ section: 'Orders', counts: await this.importOrders(J, dry) });
      if (run('dispatch')) results.push({ section: 'Dispatch', counts: await this.importDispatch(J, dry) });
      if (run('challans')) results.push({ section: 'Challans', counts: await this.importChallans(J, dry) });
      if (run('accounts')) results.push({ section: 'Accounts', counts: await this.importAccounts(J, dry) });

      if (!dry) await this.persistUploadedFile(file.buffer);

      return { ok: true, dry, fileName: file.originalname, results };
    } finally {
      try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /** Saves the uploaded file to the private, non-web-servable storage location and
   *  remembers its path so future server starts can reuse it without a new upload. */
  private async persistUploadedFile(buffer: Buffer): Promise<void> {
    ensureAccessImportDir();
    writeFileSync(ACCESS_IMPORT_FILE_PATH, buffer);
    await this.prisma.appConfig.upsert({
      where: { key: APP_CONFIG_FILE_PATH_KEY },
      create: { key: APP_CONFIG_FILE_PATH_KEY, value: ACCESS_IMPORT_FILE_PATH },
      update: { value: ACCESS_IMPORT_FILE_PATH },
    });
  }

  private export(dbPath: string, outDir: string): Promise<void> {
    const scriptPath = join(outDir + '_export.ps1');
    writeFileSync(scriptPath, EXPORT_PS, 'utf8');
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-DbPath', dbPath, '-OutDir', outDir]);
      let err = '';
      ps.stderr.on('data', (d) => (err += d.toString()));
      ps.on('error', (e) => reject(new BadRequestException('Failed to run PowerShell/ACE export: ' + e.message)));
      ps.on('close', (code) => {
        try { rmSync(scriptPath, { force: true }); } catch { /* ignore */ }
        if (code === 0) resolve();
        else reject(new BadRequestException('Access export failed: ' + (err.trim() || `exit ${code}`)));
      });
    });
  }

  /** legacy CUSTOMER.ID -> OMS customer.id, matched by party name. */
  private async customerMap(J: (n: string) => any[]): Promise<Map<number, number>> {
    const oms = await this.prisma.customer.findMany({ select: { id: true, partyName: true } });
    const byName = new Map<string, number>();
    for (const c of oms) if (c.partyName) byName.set(c.partyName.toUpperCase(), c.id);
    const map = new Map<number, number>();
    for (const c of J('CUSTOMER')) {
      const lid = int(c.ID);
      const name = s(c['PARTY NAME']);
      if (lid && name && byName.has(name.toUpperCase())) map.set(lid, byName.get(name.toUpperCase())!);
    }
    return map;
  }

  private async importMasters(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const c: Counts = {};
    const tidToId = new Map<number, number>();
    let n = 0;
    for (const t of J('TRANSPORTER')) {
      const tid = int(t.TID);
      const name = s(t['TRANSPORT NAME']);
      if (!tid || !name) continue;
      const data = { packing: num(t.PACKING), freight: num(t.FREIGHT) };
      if (!dry) {
        const row = await this.prisma.transporter.upsert({ where: { name }, create: { name, ...data }, update: data });
        tidToId.set(tid, row.id);
      }
      n++;
    }
    c.transporters = n;
    const mapTid = (tid: number | null) => (tid != null && tidToId.has(tid) ? tidToId.get(tid)! : null);

    n = 0;
    for (const x of J('CUSTOMER')) {
      const name = s(x['PARTY NAME']);
      if (!name) continue;
      const data = {
        partySource: s(x['PARTY SOURCE']), agentName: up(x['AGENT NAME']), category: up(x.CATEGORY), partyName: name,
        billingRate: num(x['BILLING RATE']), transporterId: mapTid(int(x.TID)), transportName: s(x['TRANSPORT NAME']),
        bagName: s(x['BAG NAME']), packing: num(x.PACKING), freight: num(x.FREIGHT), creditPeriod: int(x['CREDIT PERIOD']),
        city: s(x.CITY), state: s(x.STATE), region: s(x.REGION), mobile: s(x.MOBILE), email: s(x.EMAIL), brand: s(x.BRAND),
        billRatePc: num(x['BILL RATE PC']), boxRate: int(x.BOXRATE), payBy: s(x['PAY BY']),
      };
      if (!dry) {
        const ex = await this.prisma.customer.findFirst({ where: { partyName: name }, select: { id: true } });
        if (ex) await this.prisma.customer.update({ where: { id: ex.id }, data });
        else await this.prisma.customer.create({ data });
      }
      n++;
    }
    c.customers = n;

    n = 0;
    for (const p of J('PRODUCT')) {
      const category = s(p.CATEGORY) ?? '';
      const subCategory = s(p['SUB CATEGORY']) ?? '';
      const product = s(p.PRODUCT) ?? '';
      if (!category || !product) continue;
      const size = num(p.SIZE);
      const data = { weight: num(p.WEIGHT), pcs: num(p.PCS), rate: num(p.RATE) };
      if (!dry) {
        const ex = await this.prisma.product.findFirst({ where: { category, subCategory, product, size }, select: { id: true } });
        if (ex) await this.prisma.product.update({ where: { id: ex.id }, data });
        else await this.prisma.product.create({ data: { category, subCategory, product, size, ...data } });
      }
      n++;
    }
    c.products = n;

    const upsertDesign = async (category: string, subCategory: string, designType: string, cost: number | null, rate: number | null) => {
      if (!category || !designType) return false;
      if (!dry)
        await this.prisma.design.upsert({
          where: { category_subCategory_designType: { category, subCategory, designType } },
          create: { category, subCategory, designType, cost, rate },
          update: { cost, rate },
        });
      return true;
    };
    n = 0;
    for (const d of J('DESIGN')) if (await upsertDesign(s(d.CATEGORY) ?? '', s(d['SUB CATEGORY']) ?? '', s(d['DESIGN TYPE']) ?? '', num(d.COST), num(d.RATE))) n++;
    c.designs = n;
    n = 0;
    for (const m of J('COMBINATION')) if (await upsertDesign(s(m.CATEGORY) ?? '', s(m['SUB CATEGORY']) ?? '', s(m['DESIGN TYPE']) ?? '', num(m.COST), num(m.RATE))) n++;
    c['combinations→designs'] = n;

    n = 0;
    for (const d of J('DESIGNNAME')) {
      const designType = s(d['DESIGN TYPE L']);
      const designName = s(d['DESIGN NAME']);
      if (!designType || !designName) continue;
      if (!dry) {
        const ex = await this.prisma.designName.findFirst({ where: { designType, designName }, select: { id: true } });
        if (!ex) await this.prisma.designName.create({ data: { designType, designName } });
      }
      n++;
    }
    c['design names'] = n;

    const omsByName = new Map(
      (await this.prisma.customer.findMany({ select: { id: true, partyName: true } })).filter((x) => x.partyName).map((x) => [x.partyName!.toUpperCase(), x.id]),
    );
    const cmap = await this.customerMap(J);
    n = 0;
    for (const g of J('CUSTOMER_GST_RATE')) {
      const customerName = s(g['CUSTOMER NAME']);
      const category = up(g.PCATEGORY);
      if (!customerName || !category) continue;
      const data = { customerId: omsByName.get(customerName.toUpperCase()) ?? null, customerName, category, rate: int(g.RATE) };
      if (!dry) await this.prisma.gstRate.upsert({ where: { customerName_category: { customerName, category } }, create: data, update: data });
      n++;
    }
    c['gst rates'] = n;

    n = 0;
    for (const t of J('TRANS_RATE')) {
      const customerName = s(t.CUSTOMER) ?? '';
      const category = s(t.CATEGORY) ?? '';
      const type = s(t.TYPE) ?? '';
      if (!customerName || !category) continue;
      const transportName = s(t['TRANSPORT NAME']);
      const data = { customerId: cmap.get(int(t['CUS ID']) ?? -1) ?? null, customerName, category, type, transporterId: mapTid(int(t.TID)), transportName, rate: int(t.RATE) };
      if (!dry) {
        const ex = await this.prisma.transRate.findFirst({ where: { customerName, category, type, transportName }, select: { id: true } });
        if (ex) await this.prisma.transRate.update({ where: { id: ex.id }, data });
        else await this.prisma.transRate.create({ data });
      }
      n++;
    }
    c['transport rates'] = n;
    return c;
  }

  private async importPriceCal(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const obj: Record<string, string> = {};
    for (const r of J('PRICECAL')) {
      const cat = up(r.CATEGORY);
      if (!cat) continue;
      obj[cat] = String(r.FIELD).toUpperCase() === 'PCS' ? 'PCS' : 'KGS';
    }
    const value = JSON.stringify(obj);
    if (!dry) await this.prisma.appConfig.upsert({ where: { key: 'CATEGORY_CALC_FIELDS' }, update: { value }, create: { key: 'CATEGORY_CALC_FIELDS', value } });
    return { 'category price-calc fields': Object.keys(obj).length };
  }

  private async importAgents(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const names = new Set<string>();
    for (const c of J('CUSTOMER')) {
      const a = up(c['AGENT NAME']);
      if (a) names.add(a);
    }
    for (const name of names) if (!dry) await this.prisma.agent.upsert({ where: { name }, create: { name }, update: {} });
    return { agents: names.size };
  }

  private async importSpecial(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    let rates = 0;
    const saveRate = async (legacyId: number | null, kind: 'PRODUCT' | 'DESIGN', scope: 'CATEGORY' | 'SUBCATEGORY' | 'ITEM', category: unknown, subCategory: unknown, target: unknown, rate: unknown) => {
      const customerId = legacyId != null ? cmap.get(legacyId) : undefined;
      if (!customerId) return;
      const cat = up(category);
      if (!cat) return;
      const sub = scope === 'CATEGORY' ? '' : up(subCategory) ?? '';
      const tgt = scope === 'ITEM' ? s(target) ?? '' : '';
      if (scope !== 'CATEGORY' && !sub) return;
      if (scope === 'ITEM' && !tgt) return;
      const r = num(rate);
      if (r == null) return;
      const key = { customerId, kind, scope, category: cat, subCategory: sub, target: tgt };
      if (!dry) await this.prisma.customerRate.upsert({ where: { customerId_kind_scope_category_subCategory_target: key }, create: { ...key, rate: r }, update: { rate: r } });
      rates++;
    };
    for (const x of J('SPRODUCT')) await saveRate(int(x.ID), 'PRODUCT', 'ITEM', x.PCATEGORY, x['SUB CATEGORY'], x.PRODUCT, x.PRATE);
    for (const x of J('SCSPRODUCT')) await saveRate(int(x.ID), 'PRODUCT', 'SUBCATEGORY', x.PCATEGORY, x['SUB CATEGORY'], null, x.PCSRATE);
    for (const x of J('SCPRODUCT')) await saveRate(int(x.ID), 'PRODUCT', 'CATEGORY', x.PCATEGORY, null, null, x.PCRATE);
    for (const x of J('SDESIGN')) await saveRate(int(x.ID), 'DESIGN', 'ITEM', x.PCATEGORY, x['SUB CATEGORY'], x.DESIGN, x.DRATE);
    for (const x of J('SCSDESIGN')) await saveRate(int(x.ID), 'DESIGN', 'SUBCATEGORY', x.PCATEGORY, x['SUB CATEGORY'], null, x.DCSRATE);
    for (const x of J('SCDESIGN')) await saveRate(int(x.ID), 'DESIGN', 'CATEGORY', x.PCATEGORY, null, null, x.DCRATE);

    let logos = 0;
    const saveLogo = async (legacyId: number | null, scope: 'CATEGORY' | 'SUBCATEGORY', category: unknown, subCategory: unknown) => {
      const customerId = legacyId != null ? cmap.get(legacyId) : undefined;
      const cat = up(category);
      if (!customerId || !cat) return;
      const sub = scope === 'CATEGORY' ? '' : up(subCategory) ?? '';
      if (scope === 'SUBCATEGORY' && !sub) return;
      const key = { customerId, scope, category: cat, subCategory: sub };
      if (!dry) await this.prisma.customerLogoRestriction.upsert({ where: { customerId_scope_category_subCategory: key }, create: key, update: {} });
      logos++;
    };
    for (const x of J('SP_CATEGORY_LOGO')) await saveLogo(int(x.ID), 'CATEGORY', x.PCATEGORY, null);
    for (const x of J('SP_SUBCATEGORY_LOGO')) await saveLogo(int(x.ID), 'SUBCATEGORY', x.PCATEGORY, x['SUB CATEGORY']);
    return { 'customer rate overrides': rates, 'logo restrictions': logos };
  }

  private async importOrders(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    const existingIds = new Set((await this.prisma.order.findMany({ select: { id: true } })).map((o) => o.id));
    const groups = new Map<number, any[]>();
    for (const r of J('ORDERTBL')) {
      const oid = int(r['ORDER ID']);
      if (!oid) continue;
      if (!groups.has(oid)) groups.set(oid, []);
      groups.get(oid)!.push(r);
    }
    let orders = 0;
    let items = 0;
    let skippedExisting = 0;
    for (const [oid, gr] of groups) {
      if (existingIds.has(oid)) {
        skippedExisting++;
        continue;
      }
      const h = gr[0];
      const header = {
        id: oid, code: `ORD-${String(oid).padStart(5, '0')}`, customerId: cmap.get(int(h['CUST ID']) ?? -1) ?? null,
        customerName: s(h['CUSTOMER NAME']) ?? '', agentName: up(h['AGENT NAME']), category: up(h.CATEGORY),
        orderDate: dt(h['ORDER DATE']) ?? new Date(0), completionDate: dt(h['COMPLETION DATE']), completionDay: int(h['COMPLETION DAY']),
        priority: up(h.PRIORITY), status: up(h.STATUS) ?? 'CONFIRMED', ordType: s(h.ORDTYPE) ?? 'SALES ORDER', userName: s(h['USER NAME']),
      };
      if (!dry) await this.prisma.order.create({ data: header });
      orders++;
      const itemData = gr.map((r) => {
        const iid = int(r.ID);
        if (!iid) return null;
        return {
          id: iid, orderId: oid, pCategory: up(r.PCATEGORY), subCategory: s(r['SUB CATEGORY']), product: s(r.PRODUCT), design: s(r.DESIGN),
          productName: s(r['PRODUCT NAME']), designType: s(r['DESIGN TYPE']), psize: num(r.PSIZE), bags: num(r.BAGS), pcs: num(r.PCS),
          gram: num(r.GRAM), box: num(r.BOX), productRate: num(r['PRODUCT RATE']), designRate: num(r['DESIGN RATE']), rate: num(r.RATE),
          calField: up(r['CAL FIELD']), priority: up(r.PRIORITY), ordType: s(r.ORDTYPE),
          status: up(r.STATUS) === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED', comment: s(r.COMMENT),
        };
      }).filter(Boolean) as any[];
      if (!dry && itemData.length) await this.prisma.orderItem.createMany({ data: itemData });
      items += itemData.length;
    }
    return { orders, 'order items': items, 'already imported (skipped)': skippedExisting };
  }

  private async importDispatch(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    const itemIds = new Set((await this.prisma.orderItem.findMany({ select: { id: true } })).map((x) => x.id));
    const orderIds = new Set((await this.prisma.order.findMany({ select: { id: true } })).map((x) => x.id));
    const existingDispatchIds = new Set((await this.prisma.dispatch.findMany({ select: { id: true } })).map((x) => x.id));
    const batch: any[] = [];
    let skipped = 0;
    let skippedExisting = 0;
    for (const r of J('DispatchTbl')) {
      const id = int(r.DispatchID);
      const oid = int(r['ORDER ID']);
      const oitem = int(r.OrdTrans);
      if (!id || !oid || !oitem || !orderIds.has(oid) || !itemIds.has(oitem)) {
        skipped++;
        continue;
      }
      if (existingDispatchIds.has(id)) {
        skippedExisting++;
        continue;
      }
      const st = up(r.DispatchStatus) ?? '';
      batch.push({
        id, code: `DSP-${String(id).padStart(5, '0')}`, orderItemId: oitem, orderId: oid, orderCode: `ORD-${String(oid).padStart(5, '0')}`,
        customerId: cmap.get(int(r['CUST ID']) ?? -1) ?? null, customerName: s(r['CUSTOMER NAME']) ?? '', agentName: up(r['AGENT NAME']),
        category: up(r.CATEGORY), pCategory: up(r.PCATEGORY), subCategory: s(r['SUB CATEGORY']), product: s(r.PRODUCT), productName: s(r['PRODUCT NAME']),
        designType: s(r['DESIGN TYPE']), psize: num(r.PSIZE), priority: up(r.PRIORITY), calField: up(r['CAL FIELD']), ordType: s(r.ORDTYPE),
        productRate: num(r['PRODUCT RATE']), designRate: num(r['DESIGN RATE']), rate: num(r.RATE), bags: num(r.BAGS), pcs: num(r.PCS), gram: num(r.GRAM), box: num(r.BOX),
        dispatchStatus: st.includes('FULL') ? 'FULLY DISPATCH' : 'PARTIALLY DISPATCH', dispatchDate: dt(r.DispDate) ?? dt(r['ORDER DATE']) ?? new Date(0),
        comment: s(r.COMMENT), supItem: s(r.SupItem), userName: s(r['USER NAME']),
      });
    }
    if (!dry) for (let i = 0; i < batch.length; i += 500) await this.prisma.dispatch.createMany({ data: batch.slice(i, i + 500) });
    return { dispatches: batch.length, 'skipped (no matching order/item)': skipped, 'already imported (skipped)': skippedExisting };
  }

  /** InvTbl (header) + ChallanTbl (lines) → challans / challan_items. Upsert by
   *  challan code so re-running updates rather than duplicates; legacy DispatchID is
   *  preserved on each line (so those dispatches drop out of Pending Challan). */
  private async importChallans(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const cmap = await this.customerMap(J);
    const omsByName = new Map(
      (await this.prisma.customer.findMany({ select: { id: true, partyName: true } })).filter((x) => x.partyName).map((x) => [x.partyName!.toUpperCase(), x.id]),
    );
    const truthy = (v: unknown) => v === true || v === -1 || v === 1 || ['true', '1', '-1', 'yes'].includes(String(v ?? '').trim().toLowerCase());

    // PCATEGORY backfill sources (legacy Form14 SearchBtn): SCRAP by name, else from
    // the dispatch (by DispatchID, else by product name). Header category from CUSTOMER.
    const dispCatById = new Map<number, string>();
    const dispCatByName = new Map<string, string>();
    for (const d of J('DispatchTbl')) {
      const cat = up(d.PCATEGORY);
      if (!cat) continue;
      const id = int(d.DispatchID);
      if (id != null) dispCatById.set(id, cat);
      const pn = up(d['Product Name']);
      if (pn && !dispCatByName.has(pn)) dispCatByName.set(pn, cat);
    }
    const custCatByName = new Map<string, string>();
    for (const c of J('CUSTOMER')) {
      const pn = up(c['PARTY NAME']);
      const cat = up(c.CATEGORY);
      if (pn && cat) custCatByName.set(pn, cat);
    }
    const lineCat = (dispatchId: number | null, productName: string | null): string | null => {
      if (productName && /SCRAP/i.test(productName)) return 'SCRAP';
      if (dispatchId != null && dispCatById.has(dispatchId)) return dispCatById.get(dispatchId)!;
      const pn = up(productName);
      return (pn && dispCatByName.get(pn)) || null;
    };

    // Group line items by challan/InvNo.
    const itemsByInv = new Map<string, any[]>();
    for (const r of J('ChallanTbl')) {
      const inv = s(r.InvNo);
      if (!inv) continue;
      if (!itemsByInv.has(inv)) itemsByInv.set(inv, []);
      itemsByInv.get(inv)!.push(r);
    }

    let headers = 0;
    let items = 0;
    let skipped = 0;
    for (const h of J('InvTbl')) {
      const code = s(h.InvNo);
      if (!code) {
        skipped++;
        continue;
      }
      const customerName = s(h['Customer Name']) ?? '';
      const itemData = (itemsByInv.get(code) ?? []).map((r) => {
        const dispatchId = int(r.DispatchID);
        const productName = s(r['Product Name']);
        return {
          dispatchId,
          productName,
          design: s(r.Design),
          bags: num(r.BAGS),
          pcs: num(r.PCS),
          kgs: num(r.KGS),
          box: num(r.BOX),
          unit: s(r.Unit),
          price: num(r.Price),
          amount: num(r.Amount),
          pCategory: lineCat(dispatchId, productName),
          comment: s(r.Comment),
          userName: s(r['USER NAME']),
        };
      });

      const header = {
        code,
        prefix: s(h.Prefix),
        invDate: dt(h.InvDate) ?? new Date(0),
        invTime: s(h.InvTime),
        customerId: cmap.get(int(h.CustID) ?? -1) ?? omsByName.get(customerName.toUpperCase()) ?? null,
        customerName,
        billingAddress: s(h['Billing Add']),
        shippingAddress: s(h['Shipping Add']),
        category: custCatByName.get(customerName.toUpperCase()) ?? null,
        paymentTerm: int(h['Payment Term']),
        dueDate: dt(h['Due Date']),
        transName: s(h['Trans Name']),
        packing: num(h.Packing),
        freight: num(h.Freight),
        pouch: num(h.pouch),
        tcs: num(h.TCS),
        tds: null as number | null,
        tdsPercent: null as number | null,
        tax: num(h.Tax),
        total: num(h.Total),
        b: num(h.B),
        c: num(h.C),
        remarks: s(h.Remarks),
        gst: num(h.GST),
        billingRate: num(h.BillingRate),
        noBill: truthy(h.NoBill),
        transaction: s(h.Transaction) ?? 'SALES INVOICE',
        challanStatus: up(h['CHALLAN STATUS']) === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
        userName: s(h['USER NAME']),
      };

      if (!dry) {
        const ex = await this.prisma.challan.findUnique({ where: { code }, select: { id: true } });
        if (ex) {
          await this.prisma.challanItem.deleteMany({ where: { challanId: ex.id } });
          await this.prisma.challan.update({ where: { id: ex.id }, data: { ...header, items: { create: itemData } } });
        } else {
          await this.prisma.challan.create({ data: { ...header, items: { create: itemData } } });
        }
      }
      headers++;
      items += itemData.length;
    }
    return { challans: headers, 'challan items': items, 'skipped (no InvNo)': skipped };
  }

  /**
   * Accounts subledger (verbatim migration). All voucher nos / ref-ids / invoice
   * codes are preserved as-is, so receipts↔invoices↔advances↔openings reconcile
   * automatically; only the legacy CUS ID is remapped to the OMS customer id.
   *
   *   ACCT OPENING BALANCE  → AcctOpeningTrans (kind OPENING, drCr DEBIT)
   *   ACCT OPENING TRANS    → AcctOpeningTrans (kind CLEARANCE)
   *   ACCT LEDGER           → AcctLedger        (RECEIPT / DEBIT NOTE / CREDIT NOTE / SALES DISCOUNT)
   *   ACCT PAYMENT RECEIPT  → AcctPaymentReceipt
   *   ACCT PARTY ADVANCE    → AcctPartyAdvance
   *   ACCT PARTY DISCOUNT   → AcctPartyDiscount
   *   InvTblR + ChallanTblR → CreditNote + CreditNoteItem
   *
   * Debit Notes are NOT here — they live in InvTbl (prefix DN, Transaction='DEBIT NOTE')
   * and load via the Challans section. Each target table is fully replaced on run
   * (like Orders/Dispatch), so re-running is safe but overwrites in-app entries.
   */
  private async importAccounts(J: (n: string) => any[], dry: boolean): Promise<Counts> {
    const c: Counts = {};
    const cmap = await this.customerMap(J);
    const omsByName = new Map(
      (await this.prisma.customer.findMany({ select: { id: true, partyName: true } })).filter((x) => x.partyName).map((x) => [x.partyName!.toUpperCase(), x.id]),
    );
    /** Legacy CUS ID → OMS id, falling back to a name match, else 0 (agent/on-account). */
    const mapCust = (legacyId: unknown, name: unknown): number => {
      const lid = int(legacyId);
      if (lid != null && cmap.has(lid)) return cmap.get(lid)!;
      const nm = up(name);
      return (nm ? omsByName.get(nm) : undefined) ?? 0;
    };
    const insertMany = async (rows: any[], insert: (batch: any[]) => Promise<unknown>) => {
      for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
    };

    // ── Opening balances: OPENING (debit) + CLEARANCE rows into one table ──────
    // A NEGATIVE opening figure in the Access data is not a debit owed to us — it's
    // a CREDIT balance the party holds (an advance). Store it as a positive CREDIT
    // so it reads as an advance rather than a negative debit.
    const openingRows = J('ACCT_OPENING_BALANCE').map((r) => {
      const bank = num(r['BANK OPENING BALANCE']) ?? 0;
      const cash = num(r['CASH OPENING BALANCE']) ?? 0;
      const isCredit = bank + cash < 0;
      return {
        kind: 'OPENING',
        customerName: s(r['CUSTOMER NAME']) ?? '',
        custId: mapCust(r['CUS ID'], r['CUSTOMER NAME']),
        transDate: dt(r['OPENING DATE']) ?? new Date(0),
        bankAmt: isCredit ? -bank : bank,
        cashAmt: isCredit ? -cash : cash,
        drCr: isCredit ? 'CREDIT' : 'DEBIT',
      };
    });
    const clearanceRows = J('ACCT_OPENING_TRANS').map((r) => ({
      kind: 'CLEARANCE',
      customerName: s(r['CUSTOMER NAME']) ?? '',
      custId: mapCust(r['CUS ID'], r['CUSTOMER NAME']),
      transDate: dt(r['TRANS DATE']) ?? new Date(0),
      bankAmt: num(r['BANK AMT']) ?? 0,
      cashAmt: num(r['CASH AMT']) ?? 0,
      refRecId: s(r['REC REF ID']),
    }));
    const existingOpening = new Set(
      (await this.prisma.acctOpeningTrans.findMany({ select: { custId: true, transDate: true, kind: true, refRecId: true } }))
        .map((r) => `${r.custId}|${r.transDate.toISOString()}|${r.kind}|${r.refRecId ?? ''}`),
    );
    const newOpeningRows = openingRows.filter((r) => !existingOpening.has(`${r.custId}|${r.transDate.toISOString()}|OPENING|`));
    const newClearanceRows = clearanceRows.filter((r) => !existingOpening.has(`${r.custId}|${r.transDate.toISOString()}|CLEARANCE|${r.refRecId ?? ''}`));
    if (!dry) {
      await insertMany(newOpeningRows, (b) => this.prisma.acctOpeningTrans.createMany({ data: b }));
      await insertMany(newClearanceRows, (b) => this.prisma.acctOpeningTrans.createMany({ data: b }));
    }
    c['opening balances (new)'] = newOpeningRows.length;
    c['opening clearances (new)'] = newClearanceRows.length;

    // ── Ledger vouchers ───────────────────────────────────────────────────────
    const ledgerRows = J('ACCT_LEDGER').map((r) => ({
      voucherNo: s(r['VOUCHER NO']) ?? '',
      transDate: dt(r['TRANS DATE']) ?? new Date(0),
      customerName: s(r['CUSTOMER NAME']) ?? '',
      custId: mapCust(r['CUST ID'], r['CUSTOMER NAME']),
      agentName: s(r['AGENT NAME']),
      particulars: s(r['PARTICULARS']),
      voucherType: s(r['VOUCHER TYPE']) ?? 'RECEIPT',
      transMode: s(r['TRANS MODE']) ?? 'NONE',
      bankDebit: num(r['BANK DEBIT']) ?? 0,
      cashDebit: num(r['CASH DEBIT']) ?? 0,
      bankCredit: num(r['BANK CREDIT']) ?? 0,
      cashCredit: num(r['CASH CREDIT']) ?? 0,
      transRemarks: s(r['TRANS REMARKS']),
    }));
    const existingLedger = new Set(
      (await this.prisma.acctLedger.findMany({ select: { voucherNo: true, transDate: true, custId: true } }))
        .map((r) => `${r.voucherNo}|${r.transDate.toISOString()}|${r.custId}`),
    );
    const newLedgerRows = ledgerRows.filter((r) => !existingLedger.has(`${r.voucherNo}|${r.transDate.toISOString()}|${r.custId}`));
    if (!dry) {
      await insertMany(newLedgerRows, (b) => this.prisma.acctLedger.createMany({ data: b }));
    }
    c['ledger vouchers (new)'] = newLedgerRows.length;

    // ── Payment receipts (allocation lines) ───────────────────────────────────
    const receiptRows = J('ACCT_PAYMENT_RECEIPT').map((r) => ({
      refId: s(r['REF ID']) ?? '',
      recDate: dt(r['REC DATE']) ?? new Date(0),
      invNo: s(r['INV NO']) ?? '',
      customerName: s(r['CUSTOMER NAME']) ?? '',
      custId: mapCust(r['CUS ID'], r['CUSTOMER NAME']),
      recType: s(r['REC TYPE']) ?? 'RECEIPT',
      recAmt: num(r['REC AMT']) ?? 0,
      payMode: s(r['PAY MODE']) ?? '',
      bankName: s(r['BANK NAME']),
      chequeNo: s(r['CHEQUE NO']),
      cashTransLocation: s(r['CASH TRANS LOCATION']),
      cashRecBy: s(r['CASH REC BY']),
      modeOfAdj: s(r['MODE OF ADJ']),
      refRecId: s(r['REF REC ID']),
    }));
    const existingReceipts = new Set((await this.prisma.acctPaymentReceipt.findMany({ select: { refId: true } })).map((r) => r.refId));
    const newReceiptRows = receiptRows.filter((r) => !existingReceipts.has(r.refId));
    if (!dry) {
      await insertMany(newReceiptRows, (b) => this.prisma.acctPaymentReceipt.createMany({ data: b }));
    }
    c['receipts (new)'] = newReceiptRows.length;

    // ── Party advances (on-account) ───────────────────────────────────────────
    const advanceRows = J('ACCT_PARTY_ADVANCE').map((r) => ({
      refId: s(r['REF ID']) ?? '',
      recDate: dt(r['REC DATE']) ?? new Date(0),
      custId: mapCust(r['CUS ID'], r['CUSTOMER NAME']),
      customerName: s(r['CUSTOMER NAME']) ?? '',
      agentName: s(r['AGENT NAME']),
      bankAmt: num(r['BANK AMT']) ?? 0,
      cashAmt: num(r['CASH AMT']) ?? 0,
      payMode: s(r['PAY MODE']) ?? '',
      bankName: s(r['BANK NAME']),
      chequeNo: s(r['CHEQUE NO']),
      cashTransLocation: s(r['CASH TRANS LOCATION']),
      cashRecBy: s(r['CASH REC BY']),
      recType: s(r['REC TYPE']) ?? 'RECEIPT',
      refRecId: s(r['REC REF ID']),
      takeAccOn: s(r['TAKE ACC ON']),
    }));
    const existingAdvances = new Set((await this.prisma.acctPartyAdvance.findMany({ select: { refId: true } })).map((r) => r.refId));
    const newAdvanceRows = advanceRows.filter((r) => !existingAdvances.has(r.refId));
    if (!dry) {
      await insertMany(newAdvanceRows, (b) => this.prisma.acctPartyAdvance.createMany({ data: b }));
    }
    c['advances (new)'] = newAdvanceRows.length;

    // ── Sales discounts ───────────────────────────────────────────────────────
    const discountRows = J('ACCT_PARTY_DISCOUNT').map((r) => ({
      disDate: dt(r['DIS DATE']) ?? new Date(0),
      invNo: s(r['INV NO']) ?? '',
      customerName: s(r['CUSTOMER NAME']) ?? '',
      custId: mapCust(r['CUS ID'], r['CUSTOMER NAME']),
      invAmt: num(r['INV AMT']) ?? 0,
      disAmt: num(r['DIS AMT']) ?? 0,
      billType: s(r['BILL TYPE']) ?? 'BANK',
      voucherNo: null as string | null,
    }));
    const existingDiscounts = new Set(
      (await this.prisma.acctPartyDiscount.findMany({ select: { invNo: true, custId: true, disDate: true } }))
        .map((r) => `${r.invNo}|${r.custId}|${r.disDate.toISOString()}`),
    );
    const newDiscountRows = discountRows.filter((r) => !existingDiscounts.has(`${r.invNo}|${r.custId}|${r.disDate.toISOString()}`));
    if (!dry) {
      await insertMany(newDiscountRows, (b) => this.prisma.acctPartyDiscount.createMany({ data: b }));
    }
    c['discounts (new)'] = newDiscountRows.length;

    // ── Credit notes (InvTblR header + ChallanTblR lines) ─────────────────────
    const custCatByName = new Map<string, string>();
    for (const cu of J('CUSTOMER')) {
      const pn = up(cu['PARTY NAME']);
      const cat = up(cu.CATEGORY);
      if (pn && cat) custCatByName.set(pn, cat);
    }
    const cnItemsByInv = new Map<string, any[]>();
    for (const r of J('ChallanTblR')) {
      const inv = s(r.InvNo);
      if (!inv) continue;
      if (!cnItemsByInv.has(inv)) cnItemsByInv.set(inv, []);
      cnItemsByInv.get(inv)!.push(r);
    }
    const timeOf = (v: unknown): string | null => {
      const d = dt(v);
      return d ? d.toTimeString().slice(0, 5) : null;
    };
    let cnHeaders = 0;
    let cnItems = 0;
    let cnSkipped = 0;
    let cnSkippedExisting = 0;
    const cnHeaderRows = J('InvTblR');
    const existingCnCodes = new Set((await this.prisma.creditNote.findMany({ select: { code: true } })).map((r) => r.code));
    for (const h of cnHeaderRows) {
      const code = s(h.InvNo);
      if (!code) {
        cnSkipped++;
        continue;
      }
      if (existingCnCodes.has(code)) {
        cnSkippedExisting++;
        continue;
      }
      const customerName = s(h['Customer Name']) ?? '';
      const itemData = (cnItemsByInv.get(code) ?? []).map((r) => ({
        dispatchId: int(r.DispatchID) || null,
        refInvNo: s(r['Ref InvNo']),
        productName: s(r['Product Name']),
        design: s(r.Design),
        bags: num(r.BAGS),
        pcs: num(r.PCS),
        kgs: num(r.KGS),
        box: num(r.BOX),
        unit: s(r.Unit),
        price: num(r.Price),
        amount: num(r.Amount),
        pCategory: up(r.PCATEGORY),
        comment: s(r.Comment),
        userName: s(r['USER NAME']),
      }));
      cnItems += itemData.length;
      cnHeaders++;
      if (dry) continue;
      await this.prisma.creditNote.create({
        data: {
          code,
          prefix: s(h.Prefix) ?? 'CN',
          invDate: dt(h.InvDate) ?? new Date(0),
          invTime: timeOf(h.InvTime),
          customerId: mapCust(h.CustID, customerName) || null,
          customerName,
          billingAddress: s(h['Billing Add']),
          shippingAddress: s(h['Shipping Add']),
          category: custCatByName.get(customerName.toUpperCase()) ?? null,
          paymentTerm: int(h['Payment Term']),
          dueDate: dt(h['Due Date']),
          transName: s(h['Trans Name']),
          packing: num(h.Packing),
          freight: num(h.Freight),
          pouch: num(h.Pouch),
          tax: num(h.Tax),
          total: num(h.Total),
          b: num(h.B),
          c: num(h.C),
          remarks: s(h.Remarks),
          gst: num(h.GST),
          freightRate: num(h.FreightRate),
          packingRate: num(h.PackingRate),
          billingRate: num(h.BillingRate),
          bpcRate: num(h.BpcRate),
          noBill: false,
          status: 'CREDIT NOTE',
          items: { create: itemData },
        },
      });
    }
    c['credit notes'] = cnHeaders;
    c['credit note items'] = cnItems;
    if (cnSkipped) c['credit notes skipped (no InvNo)'] = cnSkipped;
    if (cnSkippedExisting) c['credit notes already imported (skipped)'] = cnSkippedExisting;

    return c;
  }
}
