import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import {
  BookingQueryDto,
  ConvertBookingDto,
  CreateBookingDto,
  LinkableItemsQueryDto,
  LinkBookingItemsDto,
  PrecloseBookingDto,
  PriceHistoryQueryDto,
  UpdateBookingDto,
} from './dto/booking.dto';

const R = RESOURCES.BOOKING;

@ApiTags('Bag Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: BookingQueryDto) {
    return this.bookings.findMany(query);
  }

  /** Unified product/design/special-rate price-change history. */
  @Get('price-history')
  @Permissions(perm(R, ACTIONS.VIEW))
  priceHistory(@Query() query: PriceHistoryQueryDto) {
    return this.bookings.priceHistory(query);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.findOne(id);
  }

  /** Order-wise sales detail for this booking, as a Tally-style B&W PDF. */
  @Get(':id/pdf')
  @Permissions(perm(R, ACTIONS.PRINT))
  async pdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { buffer, filename } = await this.bookings.generateBookingPdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateBookingDto, @CurrentUser('name') userName: string) {
    return this.bookings.create(dto, userName);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(id, dto);
  }

  /** Preview the frozen (booking-date) rates for a set of convertible lines. */
  @Post(':id/quote')
  @Permissions(perm(R, ACTIONS.VIEW))
  quote(@Param('id', ParseIntPipe) id: number, @Body() dto: ConvertBookingDto) {
    return this.bookings.quote(id, dto);
  }

  /** Convert part of the booking into real order lines at frozen rates. */
  @Post(':id/convert')
  @Permissions(perm(R, ACTIONS.CONVERT))
  @Audit({ action: ACTIONS.CONVERT, resource: R })
  convert(@Param('id', ParseIntPipe) id: number, @Body() dto: ConvertBookingDto, @CurrentUser('name') userName: string) {
    return this.bookings.convert(id, dto, userName);
  }

  @Post(':id/cancel')
  @Permissions(perm(R, ACTIONS.CANCEL))
  @Audit({ action: ACTIONS.CANCEL, resource: R })
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.cancel(id);
  }

  /** Write off a partially-converted booking's remaining qty and close it. */
  @Post(':id/preclose')
  @Permissions(perm(R, ACTIONS.PRECLOSE))
  @Audit({ action: ACTIONS.PRECLOSE, resource: R, description: 'Preclosed a bag booking (wrote off remaining qty)' })
  preclose(@Param('id', ParseIntPipe) id: number, @Body() dto: PrecloseBookingDto, @CurrentUser('name') userName: string) {
    return this.bookings.preclose(id, dto, userName);
  }

  /** Existing, not-yet-linked order lines for this booking's customer — the
   *  candidate pool for "Assign old order(s)". */
  @Get(':id/linkable-items')
  @Permissions(perm(R, ACTIONS.UPDATE))
  linkableItems(@Param('id', ParseIntPipe) id: number, @Query() query: LinkableItemsQueryDto) {
    return this.bookings.linkableItems(id, query);
  }

  /** Retroactively attach existing order line(s) to this booking. */
  @Post(':id/link-items')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Assigned existing order line(s) to a bag booking' })
  linkItems(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkBookingItemsDto) {
    return this.bookings.linkItems(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.bookings.remove(id);
    return { ok: true };
  }
}
