import { Module } from '@nestjs/common';
import { DaybookController } from './daybook.controller';
import { DaybookService } from './daybook.service';

@Module({
  controllers: [DaybookController],
  providers: [DaybookService],
})
export class DaybookModule {}
