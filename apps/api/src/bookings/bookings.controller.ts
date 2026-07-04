import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
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

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.bookings.remove(id);
    return { ok: true };
  }
}
