import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountQueryDto, CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

const R = RESOURCES.BANK_ACCOUNT;

@ApiTags('Bank Accounts')
@ApiBearerAuth()
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly banks: BankAccountsService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: BankAccountQueryDto) {
    return this.banks.findMany(query);
  }

  @Get('active')
  @Permissions(perm(R, ACTIONS.VIEW))
  active() {
    return this.banks.active();
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.banks.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Added a bank account' })
  create(@Body() dto: CreateBankAccountDto) {
    return this.banks.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Edited a bank account' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBankAccountDto) {
    return this.banks.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a bank account' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.banks.remove(id);
    return { ok: true };
  }
}
