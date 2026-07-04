import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AnalyticsService } from './analytics.service';

const R = RESOURCES.DASHBOARD;

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** KPI roll-up: order value by period, challan value, backlog, open orders. */
  @Get('dashboard')
  @Permissions(perm(R, ACTIONS.VIEW))
  dashboard() {
    return this.analytics.dashboard();
  }

  /** Monthly order value vs challan value for the last `months` months. */
  @Get('order-vs-challan')
  @Permissions(perm(R, ACTIONS.VIEW))
  orderVsChallan(@Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number) {
    return this.analytics.orderVsChallan(months);
  }

  /** Open-order backlog: value, physical qty, urgent load and age bands. */
  @Get('backlog')
  @Permissions(perm(R, ACTIONS.VIEW))
  backlog() {
    return this.analytics.backlog();
  }
}
