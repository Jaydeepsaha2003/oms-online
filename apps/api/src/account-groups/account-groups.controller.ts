import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AccountGroupsService } from './account-groups.service';
import { CreateAccountGroupDto, MoveLedgersDto, UpdateAccountGroupDto } from './account-groups.dto';

const R = RESOURCES.CUSTOMER;

@ApiTags('Account Groups')
@ApiBearerAuth()
@Controller('account-groups')
export class AccountGroupsController {
  constructor(private readonly groups: AccountGroupsService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list() {
    return this.groups.list();
  }

  @Get('ledgers')
  @Permissions(perm(R, ACTIONS.VIEW))
  ledgers() {
    return this.groups.ledgers();
  }

  @Post('ledgers/move')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Moved ledgers to another group' })
  move(@Body() dto: MoveLedgersDto) {
    return this.groups.moveLedgers(dto);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Created account group' })
  create(@Body() dto: CreateAccountGroupDto) {
    return this.groups.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Updated account group' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountGroupDto) {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted account group' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.groups.remove(id);
    return { ok: true };
  }
}
