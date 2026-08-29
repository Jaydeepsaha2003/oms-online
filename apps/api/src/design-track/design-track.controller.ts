import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { toExcelDate } from '../common/date.util';
import { ExcelService } from '../excel/excel.service';
import { DesignTrackService } from './design-track.service';
import { DesignTrackQueryDto, SetKalwatDto } from './dto/design-track.dto';

const R = RESOURCES.DESIGN_TRACK;

@ApiTags('Design Track')
@ApiBearerAuth()
@Controller('design-track')
export class DesignTrackController {
  constructor(
    private readonly designTrack: DesignTrackService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: DesignTrackQueryDto) {
    return this.designTrack.findMany(query);
  }

  // Declared before ':orderItemId'-style routes so the literal path can't be
  // swallowed as a (non-numeric) id param.
  @Get('filter-options')
  @Permissions(perm(R, ACTIONS.VIEW))
  filterOptions(@Query() query: DesignTrackQueryDto) {
    return this.designTrack.filterOptions(query);
  }

  /** Selected + available design types, for the Settings picker. */
  @Get('design-types')
  @Permissions(perm(R, ACTIONS.VIEW))
  designTypes() {
    return this.designTrack.trackedTypes();
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported Design Track' })
  async export(@Query() query: DesignTrackQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = (await this.designTrack.findAll(query)).map((r) => ({
      // Real Date, not a string — see toExcelDate(). As text these sorted by
      // day-of-month, which put 28-05-2026 above 30-06-2025.
      'Order Date': toExcelDate(r.orderDate),
      'Customer Name': r.customerName,
      'Product Name': r.productName ?? '',
      Priority: r.priority || 'NORMAL',
      'Design Type': r.designType ?? '',
      'Design Name': r.designName ?? '',
      Bags: r.bags,
      Comment: r.comment ?? '',
      Kalwat: r.kalwat ?? '',
      Dispatched: r.dispatchedBags ?? 0,
      Remaining: r.remaining,
    }));
    this.excel.setDownloadHeaders(res, 'design-track');
    return new StreamableFile(await this.excel.jsonToBuffer(rows, { sheetName: 'Design Track' }));
  }

  /** Save (or clear, with null) one line's hand-entered processed quantity. */
  @Put(':orderItemId/kalwat')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Set Design Track Kalwat qty' })
  setKalwat(
    @Param('orderItemId', ParseIntPipe) orderItemId: number,
    @Body() dto: SetKalwatDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    // The id is passed only so the person who typed the figure is left OUT of
    // the alert about it.
    return this.designTrack.setKalwat(orderItemId, dto.kalwat, user?.name ?? null, user?.id ?? null);
  }
}
