import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUrl, MinLength, ValidateNested } from 'class-validator';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { TallyService } from './tally.service';
import { TallyPartiesService } from './tally-parties.service';
import { TallyBillsService } from './tally-bills.service';
import { TallyPostingService } from './tally-posting.service';

const R = RESOURCES.TALLY;

class TallyConfigDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) url!: string;
  @IsOptional() @IsString() companyGuid?: string | null;
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
  ) {}

  /** Live check: can OMS reach Tally, and is the locked company open? */
  @Get('status')
  @Permissions(perm(R, ACTIONS.VIEW))
  status() {
    return this.svc.status();
  }

  @Put('config')
  @Permissions(perm(R, ACTIONS.MANAGE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Changed the Tally connection settings' })
  saveConfig(@Body() dto: TallyConfigDto) {
    return this.svc.saveConfig({ url: dto.url, companyGuid: dto.companyGuid ?? null });
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
  post(@Body() dto: CodeDto, @CurrentUser('name') name?: string) {
    return this.posting.post(dto.code, name ?? null);
  }

  /** Settle an unclear post by looking in Tally. */
  @Post('resolve')
  @Permissions(perm(R, ACTIONS.CREATE))
  resolve(@Body() dto: CodeDto, @CurrentUser('name') name?: string) {
    return this.posting.resolve(dto.code, name ?? null);
  }
}
