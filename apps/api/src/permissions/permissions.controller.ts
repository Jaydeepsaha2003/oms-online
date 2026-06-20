import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List the full permission catalog (for the role editor).' })
  @Permissions(perm(RESOURCES.ROLE, ACTIONS.VIEW))
  list() {
    return this.permissions.findAll();
  }
}
