import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('System')
@Controller()
export class AppController {
  /**
   * Never rate-limited. Every open tab polls this every 10s purely to decide
   * whether to tell the user the server is reachable, so throttling it can only
   * ever produce a FALSE "the server is down" — the one answer it exists to give
   * correctly. It touches nothing (no DB, no auth), so it costs nothing to serve.
   */
  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe.' })
  health() {
    return { status: 'ok', service: 'oms-api', time: new Date().toISOString() };
  }
}
