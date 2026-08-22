import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { RateListConfigService } from './rate-list-config.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, RateListConfigService],
  exports: [CustomersService, RateListConfigService],
})
export class CustomersModule {}
