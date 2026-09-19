import { Module } from '@nestjs/common';
import { AccountGroupsController } from './account-groups.controller';
import { AccountGroupsService } from './account-groups.service';

@Module({
  controllers: [AccountGroupsController],
  providers: [AccountGroupsService],
  exports: [AccountGroupsService],
})
export class AccountGroupsModule {}
