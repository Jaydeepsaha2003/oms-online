import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AccountGroupsService } from './account-groups.service';
import { CreateAccountGroupDto, MoveLedgersDto, TallyImportApplyDto, UpdateAccountGroupDto } from './account-groups.dto';

const R = RESOURCES.CUSTOMER;

@ApiTags('Account Groups')
@ApiBearerAuth()
@Controller('account-groups')
export class AccountGroupsController {
  constructor(private readonly groups: AccountGroupsService) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list() {
    return this.groups.list();
  }

  @Get('ledgers')
  @Permissions(perm(R, ACTIONS.VIEW))
  ledgers() {
    return this.groups.ledgers();
  }

  @Post('ledgers/move')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Moved ledgers to another group' })
  move(@Body() dto: MoveLedgersDto) {
    return this.groups.moveLedgers(dto);
  }

  @Post('tally-import/preview')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  tallyPreview(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Choose the Tally master export (.xml).');
    if (!/\.xml$/i.test(file.originalname)) throw new BadRequestException('Upload the Tally master exported as XML (Data Interchange).');
    return this.groups.tallyPreview(file.buffer, file.originalname);
  }

  @Post('tally-import/apply')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported Tally master (groups and ledgers)' })
  tallyApply(@Body() dto: TallyImportApplyDto, @CurrentUser('name') userName?: string) {
    return this.groups.tallyApply(dto, userName ?? null);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Created account group' })
  create(@Body() dto: CreateAccountGroupDto) {
    return this.groups.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Updated account group' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountGroupDto) {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted account group' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.groups.remove(id);
    return { ok: true };
  }
}
