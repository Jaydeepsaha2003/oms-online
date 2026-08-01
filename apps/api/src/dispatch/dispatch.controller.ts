import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, hasPermission, perm, RESOURCES } from '@oms/shared';
import { Audit, SkipAudit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ExcelService } from '../excel/excel.service';
import { formatDate } from '../common/date.util';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto, DispatchQueryDto, PendingQueryDto, UpdateDispatchDto } from './dto/dispatch.dto';

const R = RESOURCES.DISPATCH;

/** System-wide date format (dd-mm-yy) for the export cells; blank when no date. */
const fmtDate = (d?: string | null): string => formatDate(d, '');

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
  async pendingExport(@Query() query: PendingQueryDto, @Res({ passthrough: true }) res: Response) {
    const lines = await this.dispatch.pendingExport(query);
    const rows = lines.map((l) => ({
      'Order #': l.orderCode ?? '',
      'Order Date': fmtDate(l.orderDate),
      'Due Date': fmtDate(l.dueDate),
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
      Comment: l.comment ?? '',
    }));
    this.excel.setDownloadHeaders(res, 'pending-dispatch');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, {
        sheetName: 'Pending Dispatch',
        headers: ['Order #', 'Order Date', 'Due Date', 'Due', 'Customer', 'Product', 'Design', 'Sub Category', 'Priority', 'Bags', 'Pcs', 'Kgs', 'Box', 'Comment'],
      }),
    );
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
    });
  }

  /** Fully dispatch every pending line of an order at once — the New Order form's
   *  "Create & Dispatch" calls this right after the order is created. */
  @Post('fulfill-order/:orderId')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Fully dispatched an order (Create & Dispatch)' })
  fulfillOrder(@Param('orderId', ParseIntPipe) orderId: number, @CurrentUser('name') userName: string) {
    return this.dispatch.dispatchOrderFully(orderId, userName);
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
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.dispatch.remove(id);
    return { ok: true };
  }
}
