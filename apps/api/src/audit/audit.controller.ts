import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, MAX_PAGE_SIZE, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ExcelService } from '../excel/excel.service';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(RESOURCES.AUDIT_LOG, ACTIONS.VIEW))
  list(@Query() query: AuditLogQueryDto) {
    return this.audit.findMany(query);
  }

  @Get('export')
  @Permissions(perm(RESOURCES.AUDIT_LOG, ACTIONS.EXPORT))
  @Audit({ action: 'export', resource: RESOURCES.AUDIT_LOG, description: 'Exported audit log' })
  async export(
    @Query() query: AuditLogQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.audit.findMany({ ...query, page: 1, pageSize: MAX_PAGE_SIZE });
    const buffer = this.excel.export(result.items, [
      { header: 'When', key: 'createdAt' },
      { header: 'User', key: 'userEmail' },
      { header: 'Action', key: 'action' },
      { header: 'Resource', key: 'resource' },
      { header: 'Record', key: 'resourceId' },
      { header: 'Description', key: 'description' },
      { header: 'Method', key: 'method' },
      { header: 'Path', key: 'path' },
      { header: 'Status', key: 'statusCode' },
      { header: 'IP', key: 'ip' },
    ]);
    this.excel.setDownloadHeaders(res, 'audit-log');
    return new StreamableFile(buffer);
  }
}
