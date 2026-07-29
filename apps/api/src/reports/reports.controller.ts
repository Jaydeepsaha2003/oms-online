import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ReportsService } from './reports.service';

const R = RESOURCES.REPORT;

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** §8.5 — Business Overview: the whole business in one screen. */
  @Get('business-overview')
  @Permissions(perm(R, ACTIONS.VIEW))
  businessOverview() {
    return this.reports.businessOverview();
  }

  /** §8.6 — Sales & Revenue. */
  @Get('sales')
  @Permissions(perm(R, ACTIONS.VIEW))
  sales(@Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number) {
    return this.reports.salesReport(months);
  }

  /** §8.2 — Collections & Recovery. */
  @Get('collections')
  @Permissions(perm(R, ACTIONS.VIEW))
  collections() {
    return this.reports.collectionsReport();
  }

  /** §8.7 — Party Intelligence. */
  @Get('party-intel')
  @Permissions(perm(R, ACTIONS.VIEW))
  partyIntel() {
    return this.reports.partyIntel();
  }

  /** §8.8 — Product & Design. */
  @Get('products')
  @Permissions(perm(R, ACTIONS.VIEW))
  products() {
    return this.reports.productReport();
  }

  /** §8.9 — Patterns & Insights. */
  @Get('patterns')
  @Permissions(perm(R, ACTIONS.VIEW))
  patterns() {
    return this.reports.patterns();
  }

  /** §8.10 — Orders & Fulfilment. */
  @Get('fulfilment')
  @Permissions(perm(R, ACTIONS.VIEW))
  fulfilment() {
    return this.reports.fulfilment();
  }
}
