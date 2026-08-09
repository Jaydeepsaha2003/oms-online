import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PaymentsService } from './payments.service';
import { EditPaymentDto, LedgerQueryDto, PaymentContextQueryDto, SavePaymentDto } from './dto/payment.dto';

const R = RESOURCES.PAYMENT;

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Pending invoices + advances + openings for a party or an agent. */
  @Get('context')
  @Permissions(perm(R, ACTIONS.VIEW))
  context(@Query() query: PaymentContextQueryDto) {
    return this.payments.context(query);
  }

  /** Every party/agent currently sitting on an outstanding advance (whole book). */
  @Get('advances')
  @Permissions(perm(R, ACTIONS.VIEW))
  advances() {
    return this.payments.allAdvances();
  }

  /** CLEARED cheques of the party with un-received balance (CHEQUE mode picker). */
  @Get('cheque-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  chequeOptions(@Query('customerId', ParseIntPipe) customerId: number) {
    return this.payments.chequeOptions(customerId);
  }

  /** Receipt Ledger browser (voucher history for a party / agent). */
  @Get('ledger')
  @Permissions(perm(R, ACTIONS.VIEW))
  ledger(@Query() query: LedgerQueryDto) {
    return this.payments.ledger(query);
  }

  /** Save a receipt — runs the full legacy allocation waterfall in one txn. */
  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Saved a payment receipt' })
  save(@Body() dto: SavePaymentDto, @CurrentUser('name') userName?: string) {
    return this.payments.save(dto, userName);
  }

  /** Correct an already-saved receipt's amount/date/mode/remarks — reverses and
   *  replays this voucher and everything saved after it for the same party/agent. */
  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Edited a payment receipt' })
  edit(@Param('id', ParseIntPipe) id: number, @Body() dto: EditPaymentDto, @CurrentUser('name') userName?: string) {
    return this.payments.editReceipt(id, dto, userName);
  }

  /** Remove a receipt — reverses this voucher and everything saved after it for
   *  the same party/agent, then replays them all except this one. */
  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a payment receipt' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.payments.deleteReceipt(id);
  }
}
