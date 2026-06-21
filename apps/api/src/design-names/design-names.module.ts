import { Module } from '@nestjs/common';
import { DesignNamesController } from './design-names.controller';
import { DesignNamesService } from './design-names.service';

@Module({
  controllers: [DesignNamesController],
  providers: [DesignNamesService],
  exports: [DesignNamesService],
})
export class DesignNamesModule {}
