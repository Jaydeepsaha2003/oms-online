import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Permissions } from '../common/decorators/permissions.decorator';
import { DaybookService } from './daybook.service';
import { DaybookQueryDto } from './dto/daybook.dto';

const R = RESOURCES.DAYBOOK;

@ApiTags('Daybook')
@ApiBearerAuth()
@Controller('daybook')
export class DaybookController {
  constructor(private readonly svc: DaybookService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  daybook(@Query() q: DaybookQueryDto) {
    return this.svc.daybook(q);
  }
}
