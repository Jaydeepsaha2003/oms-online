import { Global, Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

/**
 * Global so any feature module can inject ApprovalsService to raise a request or
 * register a replay handler, without every one of them importing this module.
 */
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
