import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SpecialRatesService } from './special-rates.service';
import {
  AgentQueryDto,
  BulkSaveCustomerBagWeightDto,
  BulkSaveCustomerLogoDto,
  BulkSaveCustomerRateDto,
  SaveCustomerBagWeightDto,
  SaveCustomerLogoDto,
  SaveCustomerRateDto,
  SpecialRateMasterQueryDto,
  SpecialRateQueryDto,
} from './dto/special-rate.dto';

const R = RESOURCES.SPECIAL_RATE;

@ApiTags('Special Rates')
@ApiBearerAuth()
@Controller('special-rates')
export class SpecialRatesController {
  constructor(private readonly special: SpecialRatesService) {}

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.special.lookups();
  }

  @Get('agents')
  @Permissions(perm(R, ACTIONS.VIEW))
  agents() {
    return this.special.agents();
  }

  @Get('agent-customers')
  @Permissions(perm(R, ACTIONS.VIEW))
  agentCustomers(@Query() query: AgentQueryDto) {
    return this.special.agentCustomers(query.agentName);
  }

  @Get('all')
  @Permissions(perm(R, ACTIONS.VIEW))
  masterList(@Query() query: SpecialRateMasterQueryDto) {
    return this.special.masterList(query);
  }

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  forCustomer(@Query() query: SpecialRateQueryDto) {
    return this.special.forCustomer(query.customerId);
  }

  @Post('rate/bulk')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  bulkSaveRate(@Body() dto: BulkSaveCustomerRateDto, @CurrentUser('name') userName: string) {
    return this.special.bulkSaveRate(dto, userName);
  }

  @Post('logo/bulk')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  bulkSaveLogo(@Body() dto: BulkSaveCustomerLogoDto) {
    return this.special.bulkSaveLogo(dto);
  }

  @Post('rate')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  saveRate(@Body() dto: SaveCustomerRateDto, @CurrentUser('name') userName: string) {
    return this.special.saveRate(dto, userName);
  }

  @Delete('rate/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async deleteRate(@Param('id', ParseIntPipe) id: number, @CurrentUser('name') userName: string) {
    await this.special.deleteRate(id, userName);
    return { ok: true };
  }

  @Post('logo')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  saveLogo(@Body() dto: SaveCustomerLogoDto) {
    return this.special.saveLogo(dto);
  }

  @Delete('logo/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async deleteLogo(@Param('id', ParseIntPipe) id: number) {
    await this.special.deleteLogo(id);
    return { ok: true };
  }

  @Post('bag-weight/bulk')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  bulkSaveBagWeight(@Body() dto: BulkSaveCustomerBagWeightDto) {
    return this.special.bulkSaveBagWeight(dto);
  }

  @Post('bag-weight')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  saveBagWeight(@Body() dto: SaveCustomerBagWeightDto) {
    return this.special.saveBagWeight(dto);
  }

  @Delete('bag-weight/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async deleteBagWeight(@Param('id', ParseIntPipe) id: number) {
    await this.special.deleteBagWeight(id);
    return { ok: true };
  }
}
