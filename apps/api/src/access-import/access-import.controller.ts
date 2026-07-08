import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AccessImportService } from './access-import.service';

const R = RESOURCES.SETTING;

/** MS Access → OMS connector — Access stays a live parallel data source (see Settings → Data Import). */
@ApiTags('Access Import')
@ApiBearerAuth()
@Controller('access-import')
export class AccessImportController {
  constructor(private readonly svc: AccessImportService) {}

  @Get('status')
  @Permissions(perm(R, ACTIONS.VIEW))
  status() {
    return this.svc.status();
  }

  @Post('run')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  run(@UploadedFile() file: Express.Multer.File, @Body('sections') sections?: string, @Body('dry') dry?: string) {
    const list = (sections ?? '').split(',').map((x) => x.trim()).filter(Boolean) as any[];
    return this.svc.run(file, list, dry === 'true' || dry === '1');
  }
}
