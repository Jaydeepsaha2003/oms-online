import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExcelModule } from '../excel/excel.module';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

/**
 * Global so AuditService can be injected anywhere (e.g. AuthService logs
 * logins). Registers AuditInterceptor as a global interceptor.
 */
@Global()
@Module({
  imports: [ExcelModule],
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
