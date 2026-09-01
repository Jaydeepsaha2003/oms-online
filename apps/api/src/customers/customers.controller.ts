import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExcelService } from '../excel/excel.service';
import { CustomersService } from './customers.service';
import { RateListConfigService } from './rate-list-config.service';
import { BulkUpdateCustomersDto } from './dto/bulk-update-customers.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { ImportCustomersDto } from './dto/import-customers.dto';
import { SetCustomerActiveDto } from './dto/set-customer-active.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CheckCombinationDto, SavePartyRateListConfigDto, SaveRateListConfigDto } from './dto/rate-list-config.dto';

const R = RESOURCES.CUSTOMER;

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly excel: ExcelService,
    private readonly rateListConfig: RateListConfigService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: CustomerQueryDto) {
    return this.customers.findMany(query);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.customers.lookups();
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported customers' })
  async export(@Query() query: CustomerQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.customers.exportRows(query);
    this.excel.setDownloadHeaders(res, 'customers');
    return new StreamableFile(
      await this.excel.jsonToBuffer(rows, {
        sheetName: 'Customers',
        headers: this.customers.exportHeaders(),
      }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported customers from Excel' })
  import(@Body() dto: ImportCustomersDto) {
    return this.customers.importRows(dto.rows);
  }

  /** Bulk edit of the dropdown-backed columns for the ticked rows, or for every
   *  party matching the list's current filter.
   *
   *  Preview is a POST because it carries a body, not because it writes — it
   *  changes nothing. Both are declared ABOVE ':id' for the same reason as the
   *  rate-list routes below: so "bulk-update" is matched as a route rather than
   *  parsed as a customer id. */
  @Post('bulk-update/preview')
  @Permissions(perm(R, ACTIONS.UPDATE))
  previewBulkUpdate(@Body() dto: BulkUpdateCustomersDto) {
    return this.customers.previewBulkUpdate(dto);
  }

  @Patch('bulk-update')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Bulk-updated customer dropdown columns' })
  bulkUpdate(@Body() dto: BulkUpdateCustomersDto) {
    return this.customers.bulkUpdate(dto);
  }

  /* ── Rate List Settings (spec §5/§9/§10) ─────────────────────────────────
     Declared ABOVE ':id' so "rate-list-config" is matched as a route rather than
     parsed as a customer id, which would 400 on the ParseIntPipe.

     Reading a configuration needs only customer:view — the rate list screen has
     to load it to render. WRITING one changes what every future rate list
     contains, so it takes customer:update. */
  @Get('rate-list-config')
  @Permissions(perm(R, ACTIONS.VIEW))
  rateListConfigBundle() {
    return this.rateListConfig.bundle();
  }

  @Put('rate-list-config')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Updated the default rate list configuration' })
  saveRateListDefault(@Body() dto: SaveRateListConfigDto, @CurrentUser('name') userName: string) {
    return this.rateListConfig.saveDefault(dto, userName);
  }

  /** Does this set of sub-categories share one rate? (§8 — checked before any
   *  combination can be saved, and again on save itself.) */
  /** Item/design names in one category, for the override target picker. Above
   *  ':id' for the same declaration-order reason as its siblings. */
  @Get('rate-list-config/items')
  @Permissions(perm(R, ACTIONS.VIEW))
  rateListCategoryItems(@Query('category') category: string) {
    return this.rateListConfig.categoryItems(category ?? '');
  }

  @Post('rate-list-config/check-combination')
  @Permissions(perm(R, ACTIONS.VIEW))
  checkRateListCombination(@Body() dto: CheckCombinationDto) {
    return this.rateListConfig.checkCombination(dto);
  }

  /*
   * The chart rate list, with no party attached — for quoting a new enquiry.
   *
   * Declared ABOVE the ':id' routes for the same reason as 'rate-list-config':
   * Nest matches in declaration order, so a ':id' route above this one would
   * capture "rate-list" as an id and 400 on the ParseIntPipe.
   *
   * Gated on customer:view like the party sheet — it is the same catalogue and
   * the same prices, minus one party's adjustments.
   */
  @Get('rate-list/default')
  @Permissions(perm(R, ACTIONS.VIEW))
  defaultRateList(@Query('name') name?: string) {
    return this.customers.defaultRateList(name);
  }

  /**
   * The agent rate list — product price beside the agent's commission.
   *
   * Above the ':id' routes, same as its siblings. Gated on the COMMISSION
   * permission rather than customer:view: the figures on it are what an agent
   * earns, which is not something everyone who may read a price list should see.
   */
  @Get('rate-list/agent')
  @Permissions(perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEW))
  agentRateList(@Query('agentId', ParseIntPipe) agentId: number, @Query('customerId') customerId?: string) {
    const party = customerId ? Number(customerId) : null;
    return this.customers.agentRateList(agentId, Number.isFinite(party) ? party : null);
  }

  @Get(':id/rate-list-config')
  @Permissions(perm(R, ACTIONS.VIEW))
  effectiveRateListConfig(@Param('id', ParseIntPipe) id: number) {
    return this.rateListConfig.effectiveFor(id);
  }

  @Put(':id/rate-list-config')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Updated a party rate list configuration' })
  saveRateListParty(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SavePartyRateListConfigDto,
    @CurrentUser('name') userName: string,
  ) {
    return this.rateListConfig.saveParty(id, { ...dto, customerId: id }, userName);
  }

  @Delete(':id/rate-list-config')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Cleared a party rate list configuration' })
  async clearRateListParty(@Param('id', ParseIntPipe) id: number) {
    await this.rateListConfig.clearParty(id);
    return { ok: true };
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.customers.findOne(id);
  }

  @Get(':id/rate-list')
  @Permissions(perm(R, ACTIONS.VIEW))
  rateList(@Param('id', ParseIntPipe) id: number) {
    return this.customers.rateList(id);
  }

  @Get(':id/rate-history')
  @Permissions(perm(R, ACTIONS.VIEW))
  rateHistory(@Param('id', ParseIntPipe) id: number) {
    return this.customers.rateHistory(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(id, dto);
  }

  /* Declared BEFORE `@Patch(':id')` would matter if that route were a prefix of
   * this one — it is not, but keeping the narrow route adjacent to its sibling
   * makes the pair easy to read. */
  @Patch(':id/active')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Changed a customer Active flag' })
  setActive(@Param('id', ParseIntPipe) id: number, @Body() dto: SetCustomerActiveDto) {
    return this.customers.setActive(id, dto.active);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.customers.remove(id);
    return { ok: true };
  }
}
