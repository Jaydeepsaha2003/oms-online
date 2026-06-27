import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto, DispatchQueryDto, PendingQueryDto, UpdateDispatchDto } from './dto/dispatch.dto';

const R = RESOURCES.DISPATCH;

@ApiTags('Dispatch')
@ApiBearerAuth()
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('pending')
  @Permissions(perm(R, ACTIONS.VIEW))
  pending(@Query() query: PendingQueryDto) {
    return this.dispatch.pending(query);
  }

  @Get('filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  filterOptions() {
    return this.dispatch.filterOptions();
  }

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: DispatchQueryDto) {
    return this.dispatch.findMany(query);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.dispatch.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateDispatchDto, @CurrentUser('name') userName: string) {
    return this.dispatch.create(dto, userName);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDispatchDto) {
    return this.dispatch.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.dispatch.remove(id);
    return { ok: true };
  }
}
