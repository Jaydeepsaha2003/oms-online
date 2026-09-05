import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BankStatementService } from './bank-statement.service';
import {
  BankStatementAssignDto,
  BankStatementCreateDto,
  BankStatementIgnoreDto,
  BankStatementRunsQueryDto,
} from './dto/bank-statement.dto';

const R = RESOURCES.BANK_STATEMENT;

@ApiTags('Bank Statement')
@ApiBearerAuth()
@Controller('bank-statement')
export class BankStatementController {
  constructor(private readonly svc: BankStatementService) {}

  /** The column layout last used for this bank account, to pre-fill the mapping. */
  @Get('column-preset')
  @Permissions(perm(R, ACTIONS.VIEW))
  columnPreset(@Query('bankName') bankName?: string) {
    return this.svc.columnPreset(bankName);
  }

  @Get('runs')
  @Permissions(perm(R, ACTIONS.VIEW))
  runs(@Query() q: BankStatementRunsQueryDto) {
    return this.svc.runs(q);
  }

  @Get('runs/:id')
  @Permissions(perm(R, ACTIONS.VIEW))
  result(@Param('id', ParseIntPipe) id: number) {
    return this.svc.result(id);
  }

  /** Selecting a party in the dropdown — what Process would do to just them. */
  @Get('runs/:id/party/:customerId')
  @Permissions(perm(R, ACTIONS.VIEW))
  party(@Param('id', ParseIntPipe) id: number, @Param('customerId', ParseIntPipe) customerId: number) {
    return this.svc.partyPreview(id, customerId);
  }

  /** Upload: creates the saved working. Posts nothing to the ledger. */
  @Post('runs')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Uploaded a bank statement' })
  create(@Body() dto: BankStatementCreateDto, @CurrentUser('name') userName?: string) {
    return this.svc.create(dto, userName);
  }

  @Post('runs/:id/assign')
  @Permissions(perm(R, ACTIONS.CREATE))
  assign(@Param('id', ParseIntPipe) id: number, @Body() dto: BankStatementAssignDto, @CurrentUser('name') userName?: string) {
    return this.svc.assign(id, dto, userName);
  }

  @Post('runs/:id/ignore')
  @Permissions(perm(R, ACTIONS.CREATE))
  ignore(@Param('id', ParseIntPipe) id: number, @Body() dto: BankStatementIgnoreDto) {
    return this.svc.setIgnored(id, dto.rowIds, dto.ignored ?? true);
  }

  /** The one action that reaches the ledger — gated on UPDATE, so whoever does
   *  the matching need not be the one allowed to post it. */
  @Post('runs/:id/process')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Posted receipts from a bank statement' })
  process(@Param('id', ParseIntPipe) id: number, @CurrentUser('name') userName?: string) {
    return this.svc.process(id, userName);
  }

  /** Re-check a run against the ledger as it stands now, reopening any line
   *  whose receipt has since been deleted. Idempotent, and a line whose receipt
   *  is still there is left alone — so this can never cause a double posting. */
  @Post('runs/:id/recheck')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Re-checked a bank statement against the ledger' })
  recheck(@Param('id', ParseIntPipe) id: number) {
    return this.svc.recheck(id);
  }

  @Delete('runs/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a bank statement working' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.svc.remove(id);
    return { ok: true };
  }
}
