import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import { GeminiService } from './gemini.service';
import {
  AddFollowupLogDto,
  AiConfigInputDto,
  ChecklistItemInputDto,
  CreateFollowupDto,
  CrmSettingsDto,
  FollowupQueryDto,
  UpdateChecklistItemDto,
  UpdateFollowupDto,
  VoiceChecklistDto,
} from './dto/crm.dto';

const R = RESOURCES.CRM;

@ApiTags('CRM / Follow-ups')
@ApiBearerAuth()
@Controller('crm/followups')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly gemini: GeminiService,
  ) {}

  /* ── AI (Gemini voice → checklist) ──────────────────────────────────────── */

  @Get('ai/status')
  @Permissions(perm(R, ACTIONS.VIEW))
  aiStatus() {
    return this.gemini.status();
  }

  @Put('ai/config')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  aiConfig(@Body() dto: AiConfigInputDto) {
    return this.gemini.saveConfig(dto);
  }

  @Post('ai/voice-checklist')
  @Permissions(perm(R, ACTIONS.CREATE))
  voiceChecklist(@Body() dto: VoiceChecklistDto) {
    return this.gemini.voiceToChecklist(dto.audio, dto.mimeType ?? 'audio/wav');
  }

  @Get('settings')
  @Permissions(perm(R, ACTIONS.VIEW))
  getSettings() {
    return this.crm.getSettings();
  }

  @Put('settings')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  saveSettings(@Body() dto: CrmSettingsDto) {
    return this.crm.saveSettings(dto);
  }

  @Get('summary')
  @Permissions(perm(R, ACTIONS.VIEW))
  summary(@Query('kind') kind?: string) {
    return this.crm.summary(kind);
  }

  @Get('due')
  @Permissions(perm(R, ACTIONS.VIEW))
  due(@Query('kind') kind?: string) {
    return this.crm.due(kind);
  }

  @Get('board')
  @Permissions(perm(R, ACTIONS.VIEW))
  board(@Query() q: FollowupQueryDto) {
    return this.crm.board(q);
  }

  @Get('party-suggest')
  @Permissions(perm(R, ACTIONS.VIEW))
  partySuggest(@Query('q') q?: string) {
    return this.crm.partySuggest(q);
  }

  @Get('order-suggest')
  @Permissions(perm(R, ACTIONS.VIEW))
  orderSuggest(@Query('q') q?: string, @Query('party') party?: string) {
    return this.crm.orderSuggest(q, party);
  }

  @Get('product-suggest')
  @Permissions(perm(R, ACTIONS.VIEW))
  productSuggest(@Query('q') q?: string) {
    return this.crm.productSuggest(q);
  }

  @Get('party-match')
  @Permissions(perm(R, ACTIONS.VIEW))
  partyMatch(@Query('q') q?: string) {
    return this.crm.partyMatch(q);
  }

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() q: FollowupQueryDto) {
    return this.crm.findMany(q);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.crm.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateFollowupDto, @CurrentUser('name') userName: string) {
    return this.crm.create(dto, userName);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFollowupDto) {
    return this.crm.update(id, dto as CreateFollowupDto);
  }

  @Post(':id/log')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  addLog(@Param('id', ParseIntPipe) id: number, @Body() dto: AddFollowupLogDto, @CurrentUser('name') userName: string) {
    return this.crm.addLog(id, dto, userName);
  }

  @Post(':id/snooze')
  @Permissions(perm(R, ACTIONS.UPDATE))
  snooze(@Param('id', ParseIntPipe) id: number, @CurrentUser('name') userName: string) {
    return this.crm.snooze(id, userName);
  }

  @Post(':id/resolve')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  resolve(@Param('id', ParseIntPipe) id: number, @CurrentUser('name') userName: string) {
    return this.crm.resolve(id, userName);
  }

  @Post(':id/reopen')
  @Permissions(perm(R, ACTIONS.UPDATE))
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentUser('name') userName: string) {
    return this.crm.reopen(id, userName);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.crm.remove(id);
    return { ok: true };
  }

  /* ── Checklist ──────────────────────────────────────────────────────────── */

  @Post(':id/checklist')
  @Permissions(perm(R, ACTIONS.UPDATE))
  addChecklist(@Param('id', ParseIntPipe) id: number, @Body() items: ChecklistItemInputDto[]) {
    return this.crm.addChecklistItems(id, Array.isArray(items) ? items : [items]);
  }

  @Patch('checklist/:itemId')
  @Permissions(perm(R, ACTIONS.UPDATE))
  updateChecklist(@Param('itemId', ParseIntPipe) itemId: number, @Body() dto: UpdateChecklistItemDto) {
    return this.crm.updateChecklistItem(itemId, dto);
  }

  @Delete('checklist/:itemId')
  @Permissions(perm(R, ACTIONS.UPDATE))
  removeChecklist(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.crm.removeChecklistItem(itemId);
  }
}
