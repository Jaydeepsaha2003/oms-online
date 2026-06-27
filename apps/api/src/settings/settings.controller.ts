import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SettingsService } from './settings.service';
import { CreateOrderOptionDto } from './dto/order-option.dto';
import { UpdateCompanyDto } from './dto/company.dto';

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

  // Company branding — readable by any authenticated user (printed on documents).
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
