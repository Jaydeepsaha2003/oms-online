import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { OpeningBalancesService } from './opening-balances.service';
import { CreateOpeningBalanceDto, OpeningBalanceQueryDto, UpdateOpeningBalanceDto } from './dto/opening-balance.dto';

const R = RESOURCES.OPENING_BALANCE;

@ApiTags('Opening Balances')
@ApiBearerAuth()
@Controller('opening-balances')
export class OpeningBalancesController {
  constructor(private readonly opening: OpeningBalancesService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: OpeningBalanceQueryDto) {
    return this.opening.findMany(query);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.opening.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Added an opening balance' })
  create(@Body() dto: CreateOpeningBalanceDto, @CurrentUser('name') userName: string) {
    return this.opening.create(dto, userName);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOpeningBalanceDto) {
    return this.opening.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.opening.remove(id);
    return { ok: true };
  }
}
