import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { QuotationsService } from './quotations.service';
import {
  CancelQuotationDto,
  ConvertQuotationDto,
  CreateQuotationDto,
  QuotationQueryDto,
  UpdateQuotationDto,
} from './dto/quotation.dto';

const R = RESOURCES.QUOTATION;

@ApiTags('Quotations')
@ApiBearerAuth()
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: QuotationQueryDto) {
    return this.quotations.findMany(query);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.quotations.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateQuotationDto) {
    return this.quotations.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuotationDto) {
    return this.quotations.update(id, dto);
  }

  @Post(':id/sent')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: 'sent', resource: R })
  markSent(@Param('id', ParseIntPipe) id: number, @CurrentUser('name') byName: string) {
    return this.quotations.markSent(id, byName);
  }

  @Post(':id/convert')
  @Permissions(perm(R, ACTIONS.CONVERT))
  @Audit({ action: ACTIONS.CONVERT, resource: R })
  convert(@Param('id', ParseIntPipe) id: number, @Body() dto: ConvertQuotationDto) {
    return this.quotations.convert(id, dto.mode);
  }

  @Post(':id/cancel')
  @Permissions(perm(R, ACTIONS.CANCEL))
  @Audit({ action: ACTIONS.CANCEL, resource: R })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelQuotationDto,
    @CurrentUser('name') byName: string,
  ) {
    return this.quotations.cancel(id, dto, byName);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.quotations.remove(id);
    return { ok: true };
  }
}
