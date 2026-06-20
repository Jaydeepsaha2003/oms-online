import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('System')
@Controller()
export class AppController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe.' })
  health() {
    return { status: 'ok', service: 'oms-api', time: new Date().toISOString() };
  }
}
