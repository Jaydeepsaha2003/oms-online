import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { OrdersService } from './orders.service';
import { AddOrderItemPhotoDto, CreateOrderDto, OrderQueryDto, UpdateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';

const R = RESOURCES.ORDER;

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: OrderQueryDto) {
    return this.orders.findMany(query);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.orders.lookups();
  }

  @Get('filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  filterOptions() {
    return this.orders.filterOptions();
  }

  // ── Order-line photos (shared by Order Modify & Dispatch) ──────────────────
  @Get('items/:itemId/photos')
  @Permissions(perm(R, ACTIONS.VIEW))
  listPhotos(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.orders.listPhotos(itemId);
  }

  @Post('items/:itemId/photos')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Added an order line photo' })
  addPhoto(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: AddOrderItemPhotoDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.orders.addPhoto(itemId, dto, user?.email ?? null);
  }

  @Delete('photos/:photoId')
  @Permissions(perm(R, ACTIONS.UPDATE))
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
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto.status);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Edited a sales order' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) {
    return this.orders.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a sales order' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.orders.remove(id);
    return { ok: true };
  }
}
