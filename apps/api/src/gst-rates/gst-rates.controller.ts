import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ExcelService } from '../excel/excel.service';
import { GstRatesService } from './gst-rates.service';
import {
  BulkGstRateDto,
  GstRateQueryDto,
  ImportGstRatesDto,
  UpsertGstRateDto,
} from './dto/gst-rate.dto';

const R = RESOURCES.GST_RATE;

@ApiTags('Customer GST Rates')
@ApiBearerAuth()
@Controller('gst-rates')
export class GstRatesController {
  constructor(
    private readonly gstRates: GstRatesService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: GstRateQueryDto) {
    return this.gstRates.findMany(query);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.gstRates.lookups();
  }

  @Get('by-customer')
  @Permissions(perm(R, ACTIONS.VIEW))
  byCustomer(@Query('name') name: string) {
    return this.gstRates.byCustomer(name ?? '');
  }

  @Get('history')
  @Permissions(perm(R, ACTIONS.VIEW))
  history(@Query('customerName') customerName?: string, @Query('category') category?: string) {
    return this.gstRates.history({ customerName, category });
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported GST rates' })
  async export(@Query() query: GstRateQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.gstRates.exportRows(query);
    this.excel.setDownloadHeaders(res, 'customer-gst-rates');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, {
        sheetName: 'CUSTOMER GST RATE',
        headers: this.gstRates.exportHeaders(),
      }),
    );
  }

  @Get('template')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Downloaded GST rate template' })
  async template(@Res({ passthrough: true }) res: Response) {
    const rows = await this.gstRates.templateRows();
    this.excel.setDownloadHeaders(res, 'customer-gst-rates-template');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, {
        sheetName: 'GST RATE TEMPLATE',
        headers: this.gstRates.templateHeaders(),
      }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported GST rates' })
  import(@Body() dto: ImportGstRatesDto) {
    return this.gstRates.importRows(dto);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Upserted a GST rate' })
  upsert(@Body() dto: UpsertGstRateDto) {
    return this.gstRates.upsertOne(dto);
  }

  @Post('bulk')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Bulk-updated GST rates' })
  bulk(@Body() dto: BulkGstRateDto) {
    return this.gstRates.bulkUpsert(dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.gstRates.remove(id);
    return { ok: true };
  }
}
