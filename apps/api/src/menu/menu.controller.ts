import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { filterMenu, type MenuNode } from '@oms/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('Menu')
@ApiBearerAuth()
@Controller('menu')
export class MenuController {
  /**
   * Server-side, permission-filtered navigation for the current user
   * (nopCommerce-style dynamic menu). The web app can either call this or
   * filter the shared MENU client-side — both honour the same rules.
   */
  @Get()
  @ApiOperation({ summary: 'Get the navigation menu filtered to the current user.' })
  getMenu(@CurrentUser() user: AuthenticatedUser): MenuNode[] {
    return filterMenu(user.permissions);
  }
}
