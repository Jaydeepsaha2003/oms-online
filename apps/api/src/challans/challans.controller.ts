import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { ChallansService } from './challans.service';
import { ChallanQueryDto, CreateChallanDto, DraftChallanDto, ItemHistoryQueryDto, PendingChallanQueryDto, SavePrefixSettingsDto, UpdateChallanStatusDto } from './dto/challan.dto';

const R = RESOURCES.CHALLAN;

@ApiTags('Challans')
@ApiBearerAuth()
@Controller('challans')
export class ChallansController {
  constructor(private readonly challans: ChallansService) {}

  @Get('pending')
  @Permissions(perm(R, ACTIONS.VIEW))
  pending(@Query() query: PendingChallanQueryDto) {
    return this.challans.pending(query);
  }

  @Get('pending-customers')
  @Permissions(perm(R, ACTIONS.CREATE))
  pendingCustomers(@Query('search') search?: string) {
    return this.challans.pendingCustomers(search);
  }

  @Get('customer-names')
  @Permissions(perm(R, ACTIONS.CREATE))
  allCustomerNames(@Query('search') search?: string) {
    return this.challans.allCustomerNames(search);
  }

  @Post('draft')
  @Permissions(perm(R, ACTIONS.CREATE))
  draft(@Body() dto: DraftChallanDto) {
    return this.challans.draft(dto);
  }

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: ChallanQueryDto) {
    return this.challans.findMany(query);
  }

  @Get('summary')
  @Permissions(perm(R, ACTIONS.VIEW))
  summary(@Query() query: ChallanQueryDto) {
    return this.challans.summary(query);
  }

  @Get('analytics')
  @Permissions(perm(R, ACTIONS.VIEW))
  analytics(@Query() query: ChallanQueryDto) {
    return this.challans.analytics(query);
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.VIEW))
  exportAll(@Query() query: ChallanQueryDto) {
    return this.challans.exportAll(query);
  }

  @Get('item-names')
  @Permissions(perm(R, ACTIONS.VIEW))
  itemNames(@Query('search') search?: string) {
    return this.challans.itemNames(search);
  }

  @Get('item-history')
  @Permissions(perm(R, ACTIONS.VIEW))
  itemHistory(@Query() query: ItemHistoryQueryDto) {
    return this.challans.itemHistory(query);
  }

  @Get('settings')
  @Permissions(perm(R, ACTIONS.VIEW))
  getPrefixSettings() {
    return this.challans.getPrefixSettings();
  }

  @Put('settings')
  @Permissions(perm(RESOURCES.SETTING, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: RESOURCES.SETTING })
  savePrefixSettings(@Body() dto: SavePrefixSettingsDto) {
    return this.challans.savePrefixSettings(dto);
  }

  @Get('next-code')
  @Permissions(perm(R, ACTIONS.CREATE))
  nextCode(@Query('prefix') prefix?: string, @Query('date') date?: string) {
    return this.challans.previewNextCode(prefix, date);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.challans.findOne(id);
  }

  @Get(':id/edit')
  @Permissions(perm(R, ACTIONS.UPDATE))
  editContext(@Param('id', ParseIntPipe) id: number) {
    return this.challans.editContext(id);
  }

  @Put(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateChallanDto) {
    return this.challans.update(id, dto);
  }

  @Patch(':id/status')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChallanStatusDto) {
    return this.challans.updateStatus(id, dto.challanStatus);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.challans.remove(id);
  }

  @Get(':id/challan.pdf')
  @Permissions(perm(R, ACTIONS.PRINT))
  async pdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { buffer, filename } = await this.challans.challanPdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateChallanDto) {
    return this.challans.create(dto);
  }
}
