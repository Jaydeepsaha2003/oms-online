import { Module } from '@nestjs/common';
import { AgentCommissionController } from './agent-commission.controller';
import { AgentCommissionService } from './agent-commission.service';

/** Agent commission, cheque bounce history and settlement. Self-contained: it
 *  reads challans/receipts/cheques but writes only to its own tables, so the
 *  party's accounting is never touched from here. */
@Module({
  controllers: [AgentCommissionController],
  providers: [AgentCommissionService],
  exports: [AgentCommissionService],
})
export class AgentCommissionModule {}
