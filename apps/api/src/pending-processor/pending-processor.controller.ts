import { BadRequestException, Controller, Get, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PendingProcessorService } from './pending-processor.service';

const R = RESOURCES.DISPATCH;

@ApiTags('Pending Order Processor')
@ApiBearerAuth()
@Controller('pending-processor')
export class PendingProcessorController {
  constructor(private readonly processor: PendingProcessorService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.EXPORT))
  info() {
    return this.processor.info();
  }

  @Post('lookups')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Loaded the Pending Order Processor lookups' })
  importLookups(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('name') userName?: string) {
    if (!file) throw new BadRequestException('Choose the Pending Order Processor workbook (.xlsm).');
    if (!/\.xls[xm]$/i.test(file.originalname)) throw new BadRequestException('Upload the processor workbook (.xlsm or .xlsx).');
    return this.processor.importLookups(file.buffer, file.originalname, userName ?? null);
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Downloaded the processed pending orders' })
  async export(@Res({ passthrough: true }) res: Response) {
    const { buffer, fileName } = await this.processor.build();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }
}
