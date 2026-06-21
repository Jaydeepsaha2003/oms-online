import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { TransportersService } from './transporters.service';
import {
  CreateTransporterDto,
  ImportTransportersDto,
  TransporterQueryDto,
  UpdateTransporterDto,
} from './dto/transporter.dto';

const R = RESOURCES.TRANSPORTER;

@ApiTags('Transporters')
@ApiBearerAuth()
@Controller('transporters')
export class TransportersController {
  constructor(
    private readonly transporters: TransportersService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: TransporterQueryDto) {
    return this.transporters.findMany(query);
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported transporters' })
  async export(@Query() query: TransporterQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.transporters.exportRows(query);
    this.excel.setDownloadHeaders(res, 'transporters');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, {
        sheetName: 'Transporters',
        headers: this.transporters.exportHeaders(),
      }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported transporters' })
  import(@Body() dto: ImportTransportersDto) {
    return this.transporters.importRows(dto);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.transporters.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateTransporterDto) {
    return this.transporters.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTransporterDto) {
    return this.transporters.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.transporters.remove(id);
    return { ok: true };
  }
}
