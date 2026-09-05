import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES, type BulkDeletePaymentResult, type DeletePaymentResult } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { buildPendingInvoicesReport } from './pending-report.builder';
import { PaymentsService } from './payments.service';
import { BulkDeletePaymentsDto, EditPaymentDto, LedgerQueryDto, PaymentContextQueryDto, PendingReportDto, SavePaymentDto } from './dto/payment.dto';

const R = RESOURCES.PAYMENT;

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Pending invoices + advances + openings for a party or an agent. */
  @Get('context')
  @Permissions(perm(R, ACTIONS.VIEW))
  context(@Query() query: PaymentContextQueryDto) {
    return this.payments.context(query);
  }

  /** Every party/agent currently sitting on an outstanding advance (whole book). */
  @Get('advances')
  @Permissions(perm(R, ACTIONS.VIEW))
  advances() {
    return this.payments.allAdvances();
  }

  /** CLEARED cheques of the party with un-received balance (CHEQUE mode picker). */
  @Get('cheque-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  chequeOptions(@Query('customerId', ParseIntPipe) customerId: number) {
    return this.payments.chequeOptions(customerId);
  }

  /** Receipt Ledger browser (voucher history for a party / agent). */
  @Get('ledger')
  @Permissions(perm(R, ACTIONS.VIEW))
  ledger(@Query() query: LedgerQueryDto) {
    return this.payments.ledger(query);
  }

  /**
   * The Pending Invoices export, formatted.
   *
   * A POST because the rows carry the allocation the user is composing on
   * screen — unsaved working the server has no way to re-derive. Nothing is
   * written; this only turns what was on the screen into a styled workbook.
   */
  @Post('pending-report.xlsx')
  @Permissions(perm(R, ACTIONS.VIEW))
  async pendingReport(@Body() dto: PendingReportDto, @Res() res: Response) {
    const buffer = await buildPendingInvoicesReport({
      owner: dto.owner,
      ownerKind: dto.ownerKind === 'Agent' ? 'Agent' : 'Party',
      payMode: dto.payMode ?? '',
      asOf: dto.asOf,
      bucket: dto.bucket === 'CASH' ? 'CASH' : 'BANK',
      showParty: !!dto.showParty,
      rows: (dto.rows ?? []).map((r) => ({
        invDate: r.invDate ?? null,
        invNo: r.invNo,
        customerName: r.customerName ?? '',
        transaction: r.transaction ?? '',
        dueDate: r.dueDate ?? null,
        dueType: r.dueType ?? '',
        amt: r.amt,
        adj: r.adj,
        bal: r.bal,
        dueDays: r.dueDays ?? '',
      })),
    });
    const owner = dto.owner.replace(/[\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 30);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Pending_Invoices_${owner}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    });
    res.send(buffer);
  }

  /** Save a receipt — runs the full legacy allocation waterfall in one txn. */
  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Saved a payment receipt' })
  save(@Body() dto: SavePaymentDto, @CurrentUser('name') userName?: string) {
    return this.payments.save(dto, userName);
  }

  /** Correct an already-saved receipt's amount/date/mode/remarks — reverses and
   *  replays this voucher and everything saved after it for the same party/agent. */
  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Edited a payment receipt' })
  edit(@Param('id', ParseIntPipe) id: number, @Body() dto: EditPaymentDto, @CurrentUser('name') userName?: string) {
    return this.payments.editReceipt(id, dto, userName);
  }

  /**
   * Remove SEVERAL receipts in one transaction.
   *
   * A POST, not a DELETE: the ids travel in a body, and DELETE with a body is
   * inconsistently supported across proxies and clients. Declared ahead of
   * `@Delete(':id')` so `bulk-delete` is matched as a literal segment.
   */
  @Post('bulk-delete')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({
    action: ACTIONS.DELETE,
    resource: R,
    description: 'Deleted several payment receipts',
    /*
     * Name the vouchers. "Deleted several payment receipts" was all this ever
     * recorded, so when receipts later turned up missing there was nothing to
     * read — which ones went had to be worked out from what no longer existed.
     * The single delete has its id in the path; this one had nothing.
     *
     * The description is capped so the log stays scannable; `metadata` carries
     * the complete list either way, so nothing is lost at any size.
     */
    describe: (body) => {
      const deleted = (body as BulkDeletePaymentResult | undefined)?.deleted ?? [];
      if (!deleted.length) return null;
      const SHOWN = 12;
      const shown = deleted.slice(0, SHOWN).join(', ');
      const rest = deleted.length - SHOWN;
      return {
        description:
          `Deleted ${deleted.length} payment receipt${deleted.length === 1 ? '' : 's'}: ` +
          `${shown}${rest > 0 ? ` +${rest} more` : ''}`,
        metadata: { deleted, replayedCount: (body as BulkDeletePaymentResult).replayedCount },
      };
    },
  })
  removeMany(@Body() dto: BulkDeletePaymentsDto) {
    return this.payments.deleteReceipts(dto.ids);
  }

  /** Remove a receipt — reverses this voucher and everything saved after it for
   *  the same party/agent, then replays them all except this one. */
  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({
    action: ACTIONS.DELETE,
    resource: R,
    description: 'Deleted a payment receipt',
    // The path carries the ROW id, which stops resolving the moment the row is
    // gone — so the log said a receipt was deleted without saying which. Name
    // the voucher, the one identifier that still means something afterwards.
    describe: (body) => {
      const res = body as DeletePaymentResult | undefined;
      if (!res?.voucherNo) return null;
      return {
        description: `Deleted payment receipt ${res.voucherNo}`,
        metadata: { deleted: [res.voucherNo], replayedCount: res.replayedCount },
      };
    },
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.payments.deleteReceipt(id);
  }
}
