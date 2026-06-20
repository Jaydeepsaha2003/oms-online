import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions(perm(RESOURCES.ROLE, ACTIONS.VIEW))
  list() {
    return this.roles.findAll();
  }

  @Get(':id')
  @Permissions(perm(RESOURCES.ROLE, ACTIONS.VIEW))
  get(@Param('id') id: string) {
    return this.roles.findOne(id);
  }

  @Post()
  @Permissions(perm(RESOURCES.ROLE, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: RESOURCES.ROLE })
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(RESOURCES.ROLE, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: RESOURCES.ROLE })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(RESOURCES.ROLE, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: RESOURCES.ROLE })
  async remove(@Param('id') id: string) {
    await this.roles.remove(id);
    return { ok: true };
  }
}
