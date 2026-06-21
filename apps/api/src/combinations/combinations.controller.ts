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
import { CombinationsService } from './combinations.service';
import {
  CombinationQueryDto,
  CreateCombinationDto,
  ImportCombinationsDto,
  UpdateCombinationDto,
} from './dto/combination.dto';

const R = RESOURCES.COMBINATION;

@ApiTags('Combinations')
@ApiBearerAuth()
@Controller('combinations')
export class CombinationsController {
  constructor(
    private readonly combinations: CombinationsService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: CombinationQueryDto) {
    return this.combinations.findMany(query);
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported combinations' })
  async export(@Query() query: CombinationQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.combinations.exportRows(query);
    this.excel.setDownloadHeaders(res, 'combinations');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, {
        sheetName: 'Combinations',
        headers: this.combinations.exportHeaders(),
      }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported combinations' })
  import(@Body() dto: ImportCombinationsDto) {
    return this.combinations.importRows(dto);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.combinations.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateCombinationDto) {
    return this.combinations.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCombinationDto) {
    return this.combinations.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.combinations.remove(id);
    return { ok: true };
  }
}
