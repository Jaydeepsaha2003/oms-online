import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, ORDER_LINE_EXPORT_COLUMNS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ExcelService } from '../excel/excel.service';
import { OrdersService } from './orders.service';
import { AddOrderItemPhotoDto, CreateOrderDto, OrderQueryDto, PriceAsOfDto, UpdateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';

const R = RESOURCES.ORDER;

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: OrderQueryDto) {
    return this.orders.findMany(query);
  }

  /** Order Modify's Excel export — every line matching the screen's current
   *  filters, with a user-chosen column subset (see ORDER_LINE_EXPORT_COLUMNS). */
  @Get('export/lines')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported order lines' })
  async exportLines(@Query() query: OrderQueryDto, @Res({ passthrough: true }) res: Response) {
    const lines = await this.orders.exportLines(query);
    const rows = lines.map((l) => ({
      'Order ID': l.orderCode ?? `#${l.orderId}`,
      // Real Dates, not preformatted strings: ExcelService turns these into proper
      // date cells so "sort oldest first" and Excel's Date Filters work. As text
      // they sorted by day-of-month, so 28-05-2026 came out above 30-06-2025.
      'Order Date': l.orderDate ?? null,
      'Due Date': l.dueDate ?? null,
      'Customer Name': l.customerName,
      'Product Name': l.productName,
      'Design Type': l.designType,
      Priority: l.priority,
      Bags: l.bags,
      Pcs: l.pcs,
      Kgs: l.gram,
      Box: l.box,
      Rate: l.rate,
      Comment: l.comment,
      Status: l.status,
    }));
    const requested = new Set((query.columns ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    const active = requested.size ? ORDER_LINE_EXPORT_COLUMNS.filter((c) => requested.has(c.id)) : ORDER_LINE_EXPORT_COLUMNS;
    const headers = (active.length ? active : ORDER_LINE_EXPORT_COLUMNS).map((c) => c.header);
    this.excel.setDownloadHeaders(res, 'order-lines');
    return new StreamableFile(this.excel.jsonToBuffer(rows, { sheetName: 'Order Lines', headers }));
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.orders.lookups();
  }

  /** Order Modify's item-change rate check: would the newly-picked item have
   *  priced differently as of this order's own date? */
  @Post('price-as-of')
  @Permissions(perm(R, ACTIONS.VIEW))
  priceAsOf(@Body() dto: PriceAsOfDto) {
    return this.orders.priceAsOf(dto);
  }

  // The current filters come in so each dropdown can offer only values that
  // would actually return rows alongside the others (cascading).
  @Get('filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  filterOptions(@Query() query: OrderQueryDto) {
    return this.orders.filterOptions(query);
  }

  // ── Order-line photos (shared by Order Modify & Dispatch) ──────────────────
  //
  // These three are reachable from BOTH screens, so they accept an order editor
  // OR a dispatcher. Requiring `order:update` alone meant packing staff — who
  // hold dispatch permissions and no order-editing rights — hit "Missing
  // required permission(s): order:update" when adding the very reference photo
  // the dispatch refuses to save without.
  @Get('items/:itemId/photos')
  @AnyPermission(perm(R, ACTIONS.VIEW), perm(RESOURCES.DISPATCH, ACTIONS.VIEW))
  listPhotos(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.orders.listPhotos(itemId);
  }

  @Post('items/:itemId/photos')
  @AnyPermission(perm(R, ACTIONS.UPDATE), perm(RESOURCES.DISPATCH, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Added an order line photo' })
  addPhoto(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: AddOrderItemPhotoDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.orders.addPhoto(itemId, dto, user?.email ?? null);
  }

  @Delete('photos/:photoId')
  @AnyPermission(perm(R, ACTIONS.UPDATE), perm(RESOURCES.DISPATCH, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Removed an order line photo' })
  async deletePhoto(@Param('photoId', ParseIntPipe) photoId: number) {
    await this.orders.deletePhoto(photoId);
    return { ok: true };
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.orders.findOne(id);
  }

  @Get(':id/timeline')
  @Permissions(perm(R, ACTIONS.VIEW))
  timeline(@Param('id', ParseIntPipe) id: number) {
    return this.orders.timeline(id);
  }

  @Get(':id/bill.pdf')
  @Permissions(perm(R, ACTIONS.PRINT))
  async bill(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    try {
      const { buffer, filename } = await this.orders.generateOrderBillPdf(id, false);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
      res.send(buffer);
    } catch (error) {
      console.error('Order PDF generation error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Created a sales order' })
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Patch(':id/status')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Changed a sales order status' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.orders.updateStatus(id, dto.status, dto.reason, dto.note, user?.name ?? null);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Edited a sales order' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.orders.update(id, dto, user?.name ?? null);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a sales order' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.orders.remove(id, user?.name ?? null);
    return { ok: true };
  }
}
