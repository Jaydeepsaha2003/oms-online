import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, Headers, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUrl, MinLength, ValidateNested } from 'class-validator';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { TallyService } from './tally.service';
import { TallyPartiesService } from './tally-parties.service';
import { TallyBillsService } from './tally-bills.service';
import { TallyPostingService } from './tally-posting.service';
import { TallyNotesService } from './tally-notes.service';
import { BillReadyService } from './bill-ready.service';

const R = RESOURCES.TALLY;

/** The Tally PC script's calls: right TALLY_PC_KEY (api .env) AND a LAN source address. Returns the address. */
function pcCaller(req: Request, key: string): string {
  const want = Buffer.from(process.env.TALLY_PC_KEY ?? '');
  const got = Buffer.from(key);
  const ip = (req.ip ?? '').replace(/^::ffff:/, '');
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) throw new ForbiddenException('Bad key');
  if (!/^(192.168.|10.|172.(1[6-9]|2d|3[01]).)/.test(ip)) throw new ForbiddenException('LAN only');
  return ip;
}

class TallyConfigDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) url!: string;
  @IsOptional() @IsString() companyGuid?: string | null;
  @IsOptional() @IsString() gstLockDate?: string | null;
}

class PcHelloDto {
  @IsOptional() @IsString() mac?: string;
}

class MappingItemDto {
  @IsInt() customerId!: number;
  @IsOptional() @IsString() ledgerGuid!: string | null;
}

class AcceptDto {
  @IsString() @MinLength(3) note!: string;
}

class CodeDto {
  @IsString() @MinLength(3) code!: string;
}

class PostDto extends CodeDto {
  /** The person has read the "this party needs an e-way bill" notice. */
  @IsOptional() @IsBoolean() ewayAck?: boolean;
}

class PcPrintedDto {
  @IsString() vchNo!: string;
  @IsOptional() @IsString() party?: string;
  @IsOptional() @IsString() eway?: string;
}

class BillReadyAlertsBody {
  @IsBoolean() enabled!: boolean;
  @IsArray() @IsString({ each: true }) userIds!: string[];
}

class EwayAskDto {
  @IsArray() @IsString({ each: true }) vchNos!: string[];
}

class SaveMappingDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MappingItemDto) items!: MappingItemDto[];
}

@ApiTags('Tally Sync')
@ApiBearerAuth()
@Controller('tally')
export class TallyController {
  constructor(
    private readonly svc: TallyService,
    private readonly parties: TallyPartiesService,
    private readonly bills: TallyBillsService,
    private readonly posting: TallyPostingService,
    private readonly notes: TallyNotesService,
    private readonly billReady: BillReadyService,
  ) {}

  /** Live check: can OMS reach Tally, and is the locked company open? */
  @Get('status')
  @Permissions(perm(R, ACTIONS.VIEW))
  status() {
    return this.svc.status();
  }

  /**
   * The Tally PC says hello at start-up (scripts/tally-autostart.ps1); OMS takes the address the call came
   * FROM as the new Tally address. Needs the shared TALLY_PC_KEY (api .env) and a LAN source address.
   */
  @Public()
  @SkipThrottle()
  @Post('pc-hello')
  async pcHello(@Req() req: Request, @Headers('x-tally-key') key = '', @Body() body?: PcHelloDto) {
    const ip = pcCaller(req, key);
    await this.svc.savePcMac(body?.mac); // for Wake-on-LAN
    const cfg = await this.svc.getConfig();
    const url = `http://${ip}:9000`;
    if (cfg.url !== url) await this.svc.saveConfig({ ...cfg, url });
    return { url };
  }

  /** "Start Tally" button: asks the Tally PC script to open Tally and log in (it polls pc-poll). */
  @Post('start')
  @Permissions(perm(R, ACTIONS.MANAGE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Asked the Tally PC to start Tally' })
  async start() {
    await this.svc.requestStart();
    // The PC may be asleep: wake it and wait (up to 90 s) until it answers. pc = 'up' (Tally answers), 'awake' (PC on, Tally closed:
    // its script opens Tally within ~10 s), 'silent' (no answer: still asleep / off / not wakeable).
    const pc = await this.svc.wakeIfAsleep();
    return { requested: true, pc };
  }

  /** The Tally PC script asks every ~20 s whether someone pressed "Start Tally". Same key + LAN rule as pc-hello. */
  @Public()
  @SkipThrottle()
  @Post('pc-poll')
  async pcPoll(@Req() req: Request, @Headers('x-tally-key') key = '') {
    pcCaller(req, key);
    return { start: await this.svc.takeStart() };
  }

  /** The Tally PC script asks which of its pending bills need an e-way bill whatever the amount. Same key + LAN rule as pc-hello. */
  @Public()
  @SkipThrottle()
  @Post('pc-eway')
  async pcEway(@Req() req: Request, @Headers('x-tally-key') key = '', @Body() dto?: EwayAskDto) {
    pcCaller(req, key);
    return { required: await this.posting.ewayFor(dto?.vchNos ?? []) };
  }

  /** The Tally PC printed a bill (e-invoice / e-way done): tell the people on the "Bill ready" list. Same key + LAN rule as pc-hello. */
  @Public()
  @SkipThrottle()
  @Post('pc-printed')
  async pcPrinted(@Req() req: Request, @Headers('x-tally-key') key = '', @Body() dto?: PcPrintedDto) {
    pcCaller(req, key);
    return this.billReady.printed({ vchNo: dto?.vchNo ?? '', party: dto?.party, eway: dto?.eway });
  }

  /** Who gets "Bill ready" alerts — read by Settings, changed by an admin. */
  @Get('bill-ready-alerts')
  getBillReadyAlerts() {
    return this.billReady.getSettings();
  }

  @Put('bill-ready-alerts')
  @Permissions(perm(RESOURCES.SETTING, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: RESOURCES.SETTING, description: 'Changed who gets Bill ready alerts' })
  saveBillReadyAlerts(@Body() dto: BillReadyAlertsBody) {
    return this.billReady.saveSettings(dto);
  }

  @Put('config')
  @Permissions(perm(R, ACTIONS.MANAGE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Changed the Tally connection settings' })
  saveConfig(@Body() dto: TallyConfigDto) {
    return this.svc.saveConfig({ url: dto.url, companyGuid: dto.companyGuid ?? null, gstLockDate: dto.gstLockDate ?? null });
  }

  /** Every active party with its Tally ledger, checked live against Tally. */
  @Get('mapping')
  @Permissions(perm(R, ACTIONS.VIEW))
  mapping() {
    return this.parties.list();
  }

  /** Audited per party (before → after) by the service. */
  @Put('mapping')
  @Permissions(perm(R, ACTIONS.MANAGE))
  saveMapping(@Body() dto: SaveMappingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.parties.save({ items: dto.items.map((i) => ({ customerId: i.customerId, ledgerGuid: i.ledgerGuid || null })) }, user);
  }

  /** Last bill check: OMS invoices vs Tally vouchers, and every difference. */
  @Get('recon')
  @Permissions(perm(R, ACTIONS.VIEW))
  recon() {
    return this.bills.result();
  }

  /** Re-check every invoice of this FY against Tally now (reads Tally only). */
  @Post('recon/run')
  @Permissions(perm(R, ACTIONS.MANAGE))
  runRecon() {
    return this.bills.run();
  }

  @Post('recon/:id/accept')
  @Permissions(perm(R, ACTIONS.MANAGE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Accepted a Tally bill difference' })
  accept(@Param('id', ParseIntPipe) id: number, @Body() dto: AcceptDto, @CurrentUser('name') name?: string) {
    return this.bills.accept(id, dto.note, name ?? null);
  }

  /** What OMS would send to Tally for one invoice. Nothing is written. */
  @Get('preview')
  @Permissions(perm(R, ACTIONS.VIEW))
  preview(@Query('code') code: string) {
    return this.posting.preview(code ?? '');
  }

  /** The voucher builder run over every bill of this year already in Tally, compared with Tally's own. */
  @Post('preview/test')
  @Permissions(perm(R, ACTIONS.VIEW))
  previewTest() {
    return this.posting.testAgainstTally();
  }

  /** This year's invoices not yet in Tally, with why each can't be posted (if it can't). */
  @Get('queue')
  @Permissions(perm(R, ACTIONS.VIEW))
  queue() {
    return this.posting.queue();
  }

  /** WRITES TO TALLY: post one invoice. Every attempt is logged in tally_post_log. */
  @Post('post')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Posted an invoice to Tally' })
  post(@Body() dto: PostDto, @CurrentUser('name') name?: string) {
    return this.posting.post(dto.code, name ?? null, !!dto.ewayAck);
  }

  /** Settle an unclear post by looking in Tally. */
  @Post('resolve')
  @Permissions(perm(R, ACTIONS.CREATE))
  resolve(@Body() dto: CodeDto, @CurrentUser('name') name?: string) {
    return this.posting.resolve(dto.code, name ?? null);
  }

  /** What OMS would send for one credit note (nothing written). */
  @Get('note-preview')
  @Permissions(perm(R, ACTIONS.VIEW))
  notePreview(@Query('code') code: string) {
    return this.notes.preview(code ?? '');
  }

  /** Every linked credit note rebuilt and compared with Tally's own. */
  @Post('note-preview/test')
  @Permissions(perm(R, ACTIONS.VIEW))
  notePreviewTest() {
    return this.notes.testAgainstTally();
  }

  /** WRITES TO TALLY: post one credit note. */
  @Post('note-post')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Posted a credit note to Tally' })
  notePost(@Body() dto: CodeDto, @CurrentUser('name') name?: string) {
    return this.notes.post(dto.code, name ?? null);
  }

  @Post('note-resolve')
  @Permissions(perm(R, ACTIONS.CREATE))
  noteResolve(@Body() dto: CodeDto, @CurrentUser('name') name?: string) {
    return this.notes.resolve(dto.code, name ?? null);
  }
}
