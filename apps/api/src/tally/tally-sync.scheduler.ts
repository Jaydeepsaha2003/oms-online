import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TallyService } from './tally.service';
import { TallyBillsService } from './tally-bills.service';
import { currentFy } from './tally-parties.service';

/** Just the AlterID of every Sales voucher this FY — the slower safety net. */
const ALTERIDS_TDL =
  '<COLLECTION NAME="OmsAlterIds"><TYPE>Voucher</TYPE><FETCH>AlterId</FETCH><FILTER>OmsIsSale</FILTER></COLLECTION>' +
  '<SYSTEM TYPE="Formulae" NAME="OmsIsSale">$VoucherTypeName = "Sales"</SYSTEM>';

/**
 * Keeps OMS in step with Tally within seconds, with nothing installed in Tally.
 *
 * Every 3 s: read the company's AltVchId (~70 ms) — Tally raises it whenever
 * any voucher is saved, altered or cancelled, IRN / e-way bill included.
 * Changed → run the full bill check (the same as the "Check now" button).
 *
 * Every 60 s: the count and highest AlterID of this FY's Sales vouchers, which
 * also catch a deleted voucher or an older backup restored.
 *
 * ponytail: polling instead of a Tally-side TDL hook. A hook would fire inside
 * the accountant's voucher save and show errors there whenever OMS is off; 3 s
 * is instant enough for billing. Add the TDL only if seconds ever matter.
 */
@Injectable()
export class TallySyncScheduler {
  private readonly logger = new Logger(TallySyncScheduler.name);
  private busy = false;
  /** Last values reconciled; null after a restart, so the first tick always checks. */
  private lastAlt: number | null = null;
  private lastSignature: string | null = null;

  constructor(
    private readonly tally: TallyService,
    private readonly bills: TallyBillsService,
  ) {}

  @Interval(3_000)
  async fast(): Promise<void> {
    await this.guarded(async () => {
      const alt = (await this.tally.lockedCompany()).altVchId;
      if (alt === this.lastAlt) return;
      await this.sync(`voucher change ${this.lastAlt ?? '—'} → ${alt}`);
      this.lastAlt = alt;
    });
  }

  @Interval(60_000)
  async slow(): Promise<void> {
    await this.guarded(async () => {
      const fy = currentFy();
      const xml = await this.tally.exportFromCompany(
        'OmsAlterIds',
        ALTERIDS_TDL,
        `<SVFROMDATE TYPE="Date">${fy.from}</SVFROMDATE><SVTODATE TYPE="Date">${fy.to}</SVTODATE>`,
      );
      const ids = [...xml.matchAll(/<ALTERID(?:\s[^>]*)?>\s*(\d+)/g)].map((m) => +m[1]);
      const signature = `${ids.length}:${ids.reduce((a, b) => Math.max(a, b), 0)}`;
      if (signature === this.lastSignature) return;
      await this.sync(`sales vouchers ${signature}`);
      this.lastSignature = signature;
    });
  }

  private async sync(why: string): Promise<void> {
    const r = await this.bills.run();
    this.logger.log(`Tally ${why} — rechecked: ${r.linked} linked, ${r.rows.filter((x) => !x.accepted).length} to look at`);
  }

  /** One check at a time; Tally offline or any failure just waits for the next tick
   *  (setInterval does not catch rejections, so nothing may escape here). */
  private async guarded(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      this.logger.debug?.(`Tally auto-check skipped: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
