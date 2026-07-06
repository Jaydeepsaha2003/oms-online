import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ChequesService } from './cheques.service';
import { ChequeQueryDto, CreateChequeDto, DepositChequeDto, SettleChequeDto, UpdateChequeDto } from './dto/cheque.dto';

const R = RESOURCES.CHEQUE;

@ApiTags('Cheques')
@ApiBearerAuth()
@Controller('cheques')
export class ChequesController {
  constructor(private readonly cheques: ChequesService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: ChequeQueryDto) {
    return this.cheques.findMany(query);
  }

  @Get('summary')
  @Permissions(perm(R, ACTIONS.VIEW))
  summary() {
    return this.cheques.summary();
  }

  @Get('reminders')
  @Permissions(perm(R, ACTIONS.VIEW))
  reminders() {
    return this.cheques.reminders();
  }

  @Get('deposited')
  @Permissions(perm(R, ACTIONS.VIEW))
  deposited() {
    return this.cheques.deposited();
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.cheques.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Added a cheque' })
  create(@Body() dto: CreateChequeDto, @CurrentUser('name') userName: string) {
    return this.cheques.create(dto, userName);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChequeDto) {
    return this.cheques.update(id, dto);
  }

  @Post(':id/deposit')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Deposited a cheque' })
  deposit(@Param('id', ParseIntPipe) id: number, @Body() dto: DepositChequeDto) {
    return this.cheques.deposit(id, dto);
  }

  @Post(':id/settle')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Cleared/bounced a cheque' })
  settle(@Param('id', ParseIntPipe) id: number, @Body() dto: SettleChequeDto) {
    return this.cheques.settle(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.cheques.remove(id);
    return { ok: true };
  }
}
