import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit, SkipAudit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { SettingsService } from './settings.service';
import { CreateOrderOptionDto } from './dto/order-option.dto';
import { UpdateCompanyDto } from './dto/company.dto';
import { UpdateOrderTermsDto } from './dto/order-terms.dto';
import { UpdateOrderFooterDto } from './dto/order-footer.dto';
import { UpdateChallanTermsDto } from './dto/challan-terms.dto';
import { UpdateOrderQtyLayoutDto } from './dto/order-qty-layout.dto';
import { UpdateTcsSettingDto } from './dto/tcs-setting.dto';
import { UpdateDispatchBagThresholdDto } from './dto/dispatch-bag-threshold.dto';
import { UpdateDesignTrackTypesDto } from './dto/design-track-types.dto';

const R = RESOURCES.SETTING;

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list() {
    return this.settings.findAll();
  }

  // Company branding — public (printed on documents, and shown on the login
  // page before anyone is authenticated).
  @Public()
  @Get('company')
  company() {
    return this.settings.getCompany();
  }

  @Put('company')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  updateCompany(@Body() dto: UpdateCompanyDto) {
    return this.settings.updateCompany(dto);
  }

  // Order terms — readable by any authenticated user (printed on the Sales
  // Order / Quotation bill), editable only with setting:update.
  @Get('order-terms')
  getOrderTerms() {
    return this.settings.getOrderTerms();
  }

  @Put('order-terms')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  updateOrderTerms(@Body() dto: UpdateOrderTermsDto) {
    return this.settings.updateOrderTerms(dto);
  }

  // Order footer — readable by any authenticated user (printed on the Sales
  // Order / Quotation bill), editable only with setting:update.
  @Get('order-footer')
  getOrderFooter() {
    return this.settings.getOrderFooter();
  }

  @Put('order-footer')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  updateOrderFooter(@Body() dto: UpdateOrderFooterDto) {
    return this.settings.updateOrderFooter(dto);
  }

  // Challan terms — readable by any authenticated user (printed on the Challan
  // / Tax Invoice bill), editable only with setting:update.
  @Get('challan-terms')
  getChallanTerms() {
    return this.settings.getChallanTerms();
  }

  @Put('challan-terms')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  updateChallanTerms(@Body() dto: UpdateChallanTermsDto) {
    return this.settings.updateChallanTerms(dto);
  }

  // SCRAP challans' TCS % — readable by any authenticated user (used when
  // computing challan totals), editable only with setting:update. The service
  // writes its own audit entry (with old → new %) instead of the generic one.
  @Get('tcs-percent')
  getTcsPercent() {
    return this.settings.getTcsPercent();
  }

  @Put('tcs-percent')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @SkipAudit()
  updateTcsPercent(@Body() dto: UpdateTcsSettingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.updateTcsPercent(dto, user);
  }

  // Default dispatch bag threshold — readable by any authenticated user (the
  // Dispatch form needs it to enforce the guardrail), editable only with
  // setting:update. The service writes its own audit entry (old → new).
  @Get('dispatch-bag-threshold')
  getDispatchBagThreshold() {
    return this.settings.getDispatchBagThreshold();
  }

  @Put('dispatch-bag-threshold')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @SkipAudit()
  updateDispatchBagThreshold(@Body() dto: UpdateDispatchBagThresholdDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.updateDispatchBagThreshold(dto, user);
  }

  // Design Track's tracked design types — readable by any authenticated user
  // (the grid needs them), editable only with setting:update.
  @Get('design-track-types')
  getDesignTrackTypes() {
    return this.settings.getDesignTrackTypes();
  }

  @Put('design-track-types')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Updated the tracked design types for Design Track' })
  updateDesignTrackTypes(@Body() dto: UpdateDesignTrackTypesDto) {
    return this.settings.updateDesignTrackTypes(dto);
  }

  // Order quantity-field layout — read by the New Order form (any authenticated
  // user), editable only with setting:update.
  @Get('order-qty-layout')
  getOrderQtyLayout() {
    return this.settings.getOrderQtyLayout();
  }

  @Put('order-qty-layout')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  updateOrderQtyLayout(@Body() dto: UpdateOrderQtyLayoutDto) {
    return this.settings.updateOrderQtyLayout(dto);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  create(@Body() dto: CreateOrderOptionDto) {
    return this.settings.create(dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.settings.remove(id);
    return { ok: true };
  }
}
