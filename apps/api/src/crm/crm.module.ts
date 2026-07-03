import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { GeminiService } from './gemini.service';

@Module({
  controllers: [CrmController],
  providers: [CrmService, GeminiService],
})
export class CrmModule {}
