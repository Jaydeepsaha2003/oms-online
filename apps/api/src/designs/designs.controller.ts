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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExcelService } from '../excel/excel.service';
import { DesignsService } from './designs.service';
import { CreateDesignDto, DesignQueryDto, ImportDesignsDto, SetDesignFlagsDto, UpdateDesignDto } from './dto/design.dto';

const R = RESOURCES.DESIGN;

@ApiTags('Designs')
@ApiBearerAuth()
@Controller('designs')
export class DesignsController {
  constructor(
    private readonly designs: DesignsService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: DesignQueryDto) {
    return this.designs.findMany(query);
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported designs' })
  async export(@Query() query: DesignQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.designs.exportRows(query);
    this.excel.setDownloadHeaders(res, 'designs');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, { sheetName: 'Designs', headers: this.designs.exportHeaders() }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported designs' })
  import(@Body() dto: ImportDesignsDto) {
    return this.designs.importRows(dto);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.designs.lookups();
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.designs.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateDesignDto) {
    return this.designs.create(dto);
  }

  @Patch(':id/flags')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Toggled design active / rate-list flag' })
  setFlags(@Param('id', ParseIntPipe) id: number, @Body() dto: SetDesignFlagsDto) {
    return this.designs.setFlags(id, dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDesignDto, @CurrentUser('name') userName: string) {
    return this.designs.update(id, dto, userName);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.designs.remove(id);
    return { ok: true };
  }
}
