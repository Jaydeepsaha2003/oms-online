import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES, type PartyListsConfig } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PartyListsService } from './party-lists.service';

const R = RESOURCES.CRM;

@ApiTags('CRM / Party Lists')
@ApiBearerAuth()
@Controller('crm/party-lists')
export class PartyListsController {
  constructor(private readonly svc: PartyListsService) {}

  /** The saved list definitions (rule sets). */
  @Get('config')
  @Permissions(perm(R, ACTIONS.VIEW))
  getConfig() {
    return this.svc.getConfig();
  }

  /** Save the list definitions. */
  @Put('config')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  saveConfig(@Body() config: PartyListsConfig) {
    return this.svc.saveConfig(config);
  }

  /** Every party's live metrics + which lists they currently match. */
  @Get('evaluate')
  @Permissions(perm(R, ACTIONS.VIEW))
  evaluate() {
    return this.svc.evaluate();
  }
}
