import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateReceiptsDto, MarkRowsDto, ReconRunsQueryDto, SaveAliasDto } from './dto/tally-recon.dto';
import { TallyReconService } from './tally-recon.service';

const R = RESOURCES.TALLY_RECON;
/** A debtors register for a full year is a few hundred KB; 12 MB is generous. */
const MAX_BYTES = 12 * 1024 * 1024;

@ApiTags('Tally Reconciliation')
@ApiBearerAuth()
@Controller('tally-recon')
export class TallyReconController {
  constructor(private readonly svc: TallyReconService) {}

  /**
   * Upload a Tally register and reconcile it. The workbook is held in memory and
   * never written to disk — only the comparison it produces is stored.
   */
  @Post('runs')
  @Permissions(perm(R, ACTIONS.CREATE))
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_BYTES } }))
  run(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('name') userName?: string) {
    if (!file) throw new BadRequestException('Choose a Tally register (.xlsx) to upload.');
    if (!/\.xlsx?$/i.test(file.originalname)) {
      throw new BadRequestException('Only Excel (.xlsx) registers exported from Tally can be reconciled.');
    }
    return this.svc.run(file, userName ?? null);
  }

  @Get('runs')
  @Permissions(perm(R, ACTIONS.VIEW))
  runs(@Query() q: ReconRunsQueryDto) {
    return this.svc.runs(q.limit ?? 25);
  }

  @Get('runs/:id')
  @Permissions(perm(R, ACTIONS.VIEW))
  result(@Param('id', ParseIntPipe) id: number) {
    return this.svc.result(id);
  }

  @Delete('runs/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.svc.remove(id);
    return { ok: true };
  }

  @Get('aliases')
  @Permissions(perm(R, ACTIONS.VIEW))
  aliases() {
    return this.svc.aliases();
  }

  @Post('aliases')
  @Permissions(perm(R, ACTIONS.CREATE))
  saveAlias(@Body() dto: SaveAliasDto, @CurrentUser('name') userName?: string) {
    return this.svc.saveAlias(dto.tallyName, dto.customerId, userName ?? null);
  }

  @Delete('aliases/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  async removeAlias(@Param('id', ParseIntPipe) id: number) {
    await this.svc.removeAlias(id);
    return { ok: true };
  }

  /**
   * Mark flagged lines as pending or solved (or clear the mark). Only annotates a
   * review — it posts nothing — so recon-create is enough.
   */
  @Post('rows/mark')
  @Permissions(perm(R, ACTIONS.CREATE))
  markRows(@Body() dto: MarkRowsDto, @CurrentUser('name') userName?: string) {
    return this.svc.markRows(dto, userName ?? null);
  }

  /**
   * Enter the receipts a set of flagged rows describes. Requires the payment
   * permission as well as recon-create: this posts real vouchers.
   */
  @Post('receipts')
  @Permissions(perm(R, ACTIONS.CREATE), perm(RESOURCES.PAYMENT, ACTIONS.CREATE))
  createReceipts(@Body() dto: CreateReceiptsDto, @CurrentUser('name') userName?: string) {
    return this.svc.createReceipts(dto, userName ?? null);
  }
}
