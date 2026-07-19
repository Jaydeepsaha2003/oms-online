import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SettingsService } from './settings.service';
import { CreateOrderOptionDto } from './dto/order-option.dto';
import { UpdateCompanyDto } from './dto/company.dto';
import { UpdateOrderTermsDto } from './dto/order-terms.dto';
import { UpdateOrderFooterDto } from './dto/order-footer.dto';
import { UpdateChallanTermsDto } from './dto/challan-terms.dto';

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
