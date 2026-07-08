import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PartyLedgerService } from './party-ledger.service';
import { LedgerReceiptsQueryDto, PartyLedgerQueryDto } from './dto/party-ledger.dto';

const R = RESOURCES.PARTY_LEDGER;

@ApiTags('Party Ledger')
@ApiBearerAuth()
@Controller('party-ledger')
export class PartyLedgerController {
  constructor(private readonly svc: PartyLedgerService) {}

  /** Customers + agents for the filter dropdowns. */
  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.svc.lookups();
  }

  /** Receipts / clearances against one invoice (row-click detail). */
  @Get('receipts')
  @Permissions(perm(R, ACTIONS.VIEW))
  receipts(@Query() q: LedgerReceiptsQueryDto) {
    return this.svc.receipts(q.invNo);
  }

  /** Ledger as a landscape PDF. */
  @Get('export.pdf')
  @Permissions(perm(R, ACTIONS.PRINT))
  async pdf(@Query() q: PartyLedgerQueryDto, @Res() res: Response) {
    const { buffer, filename } = await this.svc.exportPdf(q);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  /** Ledger as an .xlsx. */
  @Get('export.xlsx')
  @Permissions(perm(R, ACTIONS.EXPORT))
  async xlsx(@Query() q: PartyLedgerQueryDto, @Res() res: Response) {
    const { buffer, filename } = await this.svc.exportExcel(q);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  /** The ledger: rows + opening/closing footer + aging KPIs. */
  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  ledger(@Query() q: PartyLedgerQueryDto) {
    return this.svc.ledger(q);
  }
}
