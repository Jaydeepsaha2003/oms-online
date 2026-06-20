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
import { TransRatesService } from './trans-rates.service';
import { ImportTransRatesDto, TransRateQueryDto, UpsertTransRateDto } from './dto/trans-rate.dto';

const R = RESOURCES.TRANS_RATE;

@ApiTags('Customer Transport Rates')
@ApiBearerAuth()
@Controller('transport-rates')
export class TransRatesController {
  constructor(
    private readonly transRates: TransRatesService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: TransRateQueryDto) {
    return this.transRates.findMany(query);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.transRates.lookups();
  }

  @Get('by-customer')
  @Permissions(perm(R, ACTIONS.VIEW))
  byCustomer(@Query('name') name: string) {
    return this.transRates.byCustomer(name ?? '');
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported transport rates' })
  async export(@Query() query: TransRateQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.transRates.exportRows(query);
    this.excel.setDownloadHeaders(res, 'customer-transport-rates');
    return new StreamableFile(this.excel.jsonToBuffer(rows, { sheetName: 'TRANS RATE' }));
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported transport rates' })
  import(@Body() dto: ImportTransRatesDto) {
    return this.transRates.importRows(dto);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Upserted a transport rate' })
  upsert(@Body() dto: UpsertTransRateDto) {
    return this.transRates.upsertOne(dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.transRates.remove(id);
    return { ok: true };
  }
}
