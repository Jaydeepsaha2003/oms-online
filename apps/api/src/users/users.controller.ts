import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES, type SessionList } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SessionsService } from '../auth/sessions.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ExcelService } from '../excel/excel.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(RESOURCES.USER, ACTIONS.VIEW))
  list(@Query() query: UserQueryDto) {
    return this.users.findMany(query);
  }

  @Get('export')
  @Permissions(perm(RESOURCES.USER, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: RESOURCES.USER, description: 'Exported users' })
  async export(@Query() query: UserQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.users.exportRows(query);
    this.excel.setDownloadHeaders(res, 'users');
    return new StreamableFile(this.excel.jsonToBuffer(rows, { sheetName: 'Users' }));
  }

  @Get(':id')
  @Permissions(perm(RESOURCES.USER, ACTIONS.VIEW))
  get(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  @Permissions(perm(RESOURCES.USER, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: RESOURCES.USER })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(RESOURCES.USER, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: RESOURCES.USER })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(RESOURCES.USER, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: RESOURCES.USER })
  async remove(@Param('id') id: string, @CurrentUser('id') currentUserId: string) {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    await this.users.remove(id);
    return { ok: true };
  }

  // ── Sessions / devices (admin) ──────────────────────────────────────────────

  /** Active devices a user is signed in from. */
  @Get(':id/sessions')
  @Permissions(perm(RESOURCES.USER, ACTIONS.VIEW))
  userSessions(@Param('id') id: string, @CurrentUser() me: AuthenticatedUser): Promise<SessionList> {
    // Mark "this device" only when an admin is viewing their own row.
    return this.sessions.list(id, id === me.id ? me.sid : undefined);
  }

  /** Sign a specific device out (immediate — the guard rejects the revoked session). */
  @Delete(':id/sessions/:sid')
  @Permissions(perm(RESOURCES.USER, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: RESOURCES.USER, description: 'Signed a user out of a device' })
  revokeUserSession(@Param('id') id: string, @Param('sid') sid: string): Promise<{ id: string }> {
    return this.sessions.revoke(id, sid);
  }

  /** Sign a user out of every device (revokes all + bumps tokenVersion). */
  @Delete(':id/sessions')
  @Permissions(perm(RESOURCES.USER, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: RESOURCES.USER, description: 'Signed a user out everywhere' })
  revokeAllUserSessions(@Param('id') id: string): Promise<{ count: number }> {
    return this.sessions.revokeAll(id);
  }
}
