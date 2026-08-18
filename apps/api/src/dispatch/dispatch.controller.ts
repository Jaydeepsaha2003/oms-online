import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, DISPATCH_EXPORT_COLUMNS, DISPATCH_RATE_EXPORT_COLUMN_IDS, hasPermission, perm, RESOURCES, type DraftPhotoCheckInput } from '@oms/shared';
import { Audit, SkipAudit } from '../common/decorators/audit.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ExcelService } from '../excel/excel.service';
import { toExcelDate } from '../common/date.util';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto, DispatchQueryDto, PendingQueryDto, UpdateDispatchDto } from './dto/dispatch.dto';

const R = RESOURCES.DISPATCH;

@ApiTags('Dispatch')
@ApiBearerAuth()
@Controller('dispatch')
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly excel: ExcelService,
  ) {}

  /** Strip rate/amount fields from rows for users without `dispatch:viewrates`,
   *  so the values never reach the client (not just hidden columns). */
  private redactRates<T extends { productRate: number | null; designRate: number | null; rate: number | null }>(
    rows: T[],
    user: AuthenticatedUser,
  ): T[] {
    if (hasPermission(user.permissions, perm(R, ACTIONS.VIEWRATES))) return rows;
    return rows.map((r) => ({ ...r, productRate: null, designRate: null, rate: null }));
  }

  @Get('pending')
  @Permissions(perm(R, ACTIONS.VIEW))
  async pending(@Query() query: PendingQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const res = await this.dispatch.pending(query);
    return { ...res, items: this.redactRates(res.items, user) };
  }

  @Get('pending/export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported pending dispatch lines' })
  async pendingExport(
    @Query() query: PendingQueryDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const lines = await this.dispatch.pendingExport(query);
    const canViewRates = hasPermission(user.permissions, perm(R, ACTIONS.VIEWRATES));
    const rows = lines.map((l) => ({
      'Order #': l.orderCode ?? '',
      // Real Dates, not strings — see toExcelDate(). As text these sorted by
      // day-of-month, which put 28-05-2026 above 30-06-2025.
      'Order Date': toExcelDate(l.orderDate),
      'Due Date': toExcelDate(l.dueDate),
      Due: l.dueType,
      Customer: l.customerName,
      Product: l.productName || l.product || '',
      Design: l.designType && l.designType.toUpperCase() !== 'NA' ? l.designType : '',
      'Sub Category': l.subCategory ?? '',
      Priority: l.priority ?? '',
      Bags: l.remBags,
      Pcs: l.remPcs,
      Kgs: l.remKgs,
      Box: l.remBox,
      'Product ₹': l.productRate ?? '',
      'Design ₹': l.designRate ?? '',
      'Rate ₹': l.rate ?? '',
      // Same as the on-screen "Pending ₹": rate × the still-pending qty, taken
      // from whichever of pcs/kgs the line is priced by (calField).
      'Pending ₹': l.rate == null ? '' : Math.round(l.rate * ((l.calField ?? '').toUpperCase() === 'PCS' ? l.remPcs : l.remKgs)),
      Comment: l.comment ?? '',
    }));
    // Which columns the user picked in the "Choose columns to export" dialog —
    // json_to_sheet only writes keys named in `headers`, so an unrecognised or
    // empty request just falls back to every column rather than an empty sheet.
    const requested = new Set((query.columns ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    // The ₹ columns are dropped outright without `dispatch:viewrates`, so an
    // ids-in-the-URL request can't export rates the user can't see on screen.
    const offered = canViewRates ? DISPATCH_EXPORT_COLUMNS : DISPATCH_EXPORT_COLUMNS.filter((c) => !DISPATCH_RATE_EXPORT_COLUMN_IDS.includes(c.id));
    const active = requested.size ? offered.filter((c) => requested.has(c.id)) : offered;
    const headers = (active.length ? active : offered).map((c) => c.header);
    this.excel.setDownloadHeaders(res, 'pending-dispatch');
    return new StreamableFile(this.excel.jsonToBuffer(rows, { sheetName: 'Pending Dispatch', headers }));
  }

  @Get('filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  filterOptions(@Query() query: DispatchQueryDto) {
    return this.dispatch.filterOptions(query);
  }

  @Get('pending-filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  pendingFilterOptions(@Query() query: PendingQueryDto) {
    return this.dispatch.pendingFilterOptions(query);
  }

  /** Has this party + item + design ever been documented with a photo? Gates
   *  the Dispatch form's photo requirement — see DispatchService.photoCheck. */
  @Get('photo-check/:orderItemId')
  @Permissions(perm(R, ACTIONS.VIEW))
  photoCheck(@Param('orderItemId', ParseIntPipe) orderItemId: number) {
    return this.dispatch.photoCheck(orderItemId);
  }

  /** The same check for lines that aren't saved yet — the New Order form's
   *  "Create & Dispatch". POST because it carries the whole form's lines; it
   *  reads only. Answers for someone drafting an ORDER, so an order-creator
   *  qualifies just as much as a dispatcher. */
  @Post('photo-check/draft')
  @AnyPermission(perm(R, ACTIONS.VIEW), perm(RESOURCES.ORDER, ACTIONS.CREATE))
  photoCheckDraft(@Body() body: DraftPhotoCheckInput) {
    return this.dispatch.photoCheckDraft(body);
  }

  /** Claim the editing lock on an order line — called when the Dispatch sheet
   *  or Modify Dispatch's edit dialog opens, and renewed while it stays open.
   *  409s (with who's holding it) if someone else already has it. Gated on
   *  `view` (not create/update) since both a new-dispatch and an edit flow
   *  share this one lock space, and view is the one thing both require. */
  @Post('lock/:orderItemId')
  @Permissions(perm(R, ACTIONS.VIEW))
  @SkipAudit()
  lock(@Param('orderItemId', ParseIntPipe) orderItemId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatch.acquireLock(orderItemId, { id: user.id, name: user.name });
  }

  /** Release the editing lock — called when the sheet/dialog closes. */
  @Delete('lock/:orderItemId')
  @Permissions(perm(R, ACTIONS.VIEW))
  @SkipAudit()
  unlock(@Param('orderItemId', ParseIntPipe) orderItemId: number, @CurrentUser() user: AuthenticatedUser) {
    this.dispatch.releaseLock(orderItemId, { id: user.id });
    return { ok: true };
  }

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  async list(@Query() query: DispatchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const res = await this.dispatch.findMany(query);
    return { ...res, items: this.redactRates(res.items, user) };
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.dispatch.findOne(id);
  }

  /**
   * Record a dispatch. A date other than today needs `dispatch:approve` — without
   * it the entry is parked in the Approvals inbox instead of being created, so the
   * response is either the new dispatch or the approval code to quote.
   */
  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  // The service writes its own rich entry (actual qty/status/date), so the
  // generic interceptor entry is switched off here rather than duplicating it.
  @SkipAudit()
  create(@Body() dto: CreateDispatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatch.submit(dto, {
      id: user.id ?? null,
      name: user.name,
      canApprove: hasPermission(user.permissions, perm(R, ACTIONS.APPROVE)),
      canOverrideThreshold: hasPermission(user.permissions, perm(R, ACTIONS.OVERRIDE)),
    });
  }

  /** Fully dispatch every pending line of an order at once — the New Order form's
   *  "Create & Dispatch" calls this right after the order is created. */
  @Post('fulfill-order/:orderId')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Fully dispatched an order (Create & Dispatch)' })
  fulfillOrder(@Param('orderId', ParseIntPipe) orderId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatch.dispatchOrderFully(orderId, { id: user.id ?? null, name: user.name });
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  // Same reasoning as create() — the service records the actual before/after.
  @SkipAudit()
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDispatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatch.updateAsUser(id, dto, {
      id: user.id ?? null,
      name: user.name,
      canApprove: hasPermission(user.permissions, perm(R, ACTIONS.APPROVE)),
    });
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a dispatch' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    await this.dispatch.remove(id, { id: user.id ?? null, name: user.name });
    return { ok: true };
  }
}
