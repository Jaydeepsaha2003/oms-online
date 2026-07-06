import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { DiscountsService } from './discounts.service';
import { DiscountHistoryQueryDto, DiscountInvoiceQueryDto, SaveDiscountDto } from './dto/discount.dto';

const R = RESOURCES.DISCOUNT;

@ApiTags('Sales Discount')
@ApiBearerAuth()
@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  /** Pending-invoice grid (bank & cash amount / discount / received / balance). */
  @Get('invoices')
  @Permissions(perm(R, ACTIONS.VIEW))
  invoices(@Query() query: DiscountInvoiceQueryDto) {
    return this.discounts.invoices(query);
  }

  /** Saved discounts for one invoice (per-invoice history). */
  @Get('history')
  @Permissions(perm(R, ACTIONS.VIEW))
  history(@Query() query: DiscountHistoryQueryDto) {
    return this.discounts.history(query);
  }

  /** Grant a discount on an invoice's bank/cash balance + post the ledger voucher. */
  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Saved a sales discount' })
  create(@Body() dto: SaveDiscountDto, @CurrentUser('name') userName?: string) {
    return this.discounts.create(dto, userName);
  }

  @Put(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveDiscountDto, @CurrentUser('name') userName?: string) {
    return this.discounts.update(id, dto, userName);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.discounts.remove(id);
  }
}
