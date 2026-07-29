import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ReportsService } from './reports.service';
import { ReportFilterDto } from './dto/report-filter.dto';

const R = RESOURCES.REPORT;

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Agents / regions / customers for the filter bar. */
  @Get('filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  filterOptions() {
    return this.reports.filterOptions();
  }

  /** §8.5 — Business Overview. */
  @Get('business-overview')
  @Permissions(perm(R, ACTIONS.VIEW))
  businessOverview(@Query() f: ReportFilterDto) {
    return this.reports.businessOverview(f);
  }

  /** §8.6 — Sales & Revenue. */
  @Get('sales')
  @Permissions(perm(R, ACTIONS.VIEW))
  sales(@Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number, @Query() f: ReportFilterDto) {
    return this.reports.salesReport(months, f);
  }

  /** §8.2 — Collections & Recovery. */
  @Get('collections')
  @Permissions(perm(R, ACTIONS.VIEW))
  collections(@Query() f: ReportFilterDto) {
    return this.reports.collectionsReport(f);
  }

  /** §8.7 — Party Intelligence. */
  @Get('party-intel')
  @Permissions(perm(R, ACTIONS.VIEW))
  partyIntel(@Query() f: ReportFilterDto) {
    return this.reports.partyIntel(f);
  }

  /** §8.8 — Product & Design. */
  @Get('products')
  @Permissions(perm(R, ACTIONS.VIEW))
  products(@Query() f: ReportFilterDto) {
    return this.reports.productReport(f);
  }

  /** §8.9 — Patterns & Insights. */
  @Get('patterns')
  @Permissions(perm(R, ACTIONS.VIEW))
  patterns(@Query() f: ReportFilterDto) {
    return this.reports.patterns(f);
  }

  /** §8.10 — Orders & Fulfilment. */
  @Get('fulfilment')
  @Permissions(perm(R, ACTIONS.VIEW))
  fulfilment(@Query() f: ReportFilterDto) {
    return this.reports.fulfilment(f);
  }
}
