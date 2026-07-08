import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES, type NoteMode } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { NotesService } from './notes.service';
import { NextNoteQueryDto, NoteDirectoryQueryDto, RecentSoldQueryDto, SaveNoteDto } from './dto/note.dto';

const R = RESOURCES.NOTE;

@ApiTags('Debit / Credit Note')
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** This customer's last 12 months of sold items — the product picker source. */
  @Get('recent-sold')
  @Permissions(perm(R, ACTIONS.CREATE))
  recentSold(@Query() q: RecentSoldQueryDto) {
    return this.notes.recentSold(q.customerId);
  }

  /** Next voucher number for the mode (DN/<n> or CN/<n>). */
  @Get('next')
  @Permissions(perm(R, ACTIONS.CREATE))
  next(@Query() q: NextNoteQueryDto) {
    return this.notes.nextNo(q.mode as NoteMode);
  }

  /** Directory list for the mode, with date / pay-mode filters. */
  @Get('directory')
  @Permissions(perm(R, ACTIONS.VIEW))
  directory(@Query() q: NoteDirectoryQueryDto) {
    return this.notes.directory(q);
  }

  /** One note (header + items) for the editor. */
  @Get(':mode/:code')
  @Permissions(perm(R, ACTIONS.VIEW))
  getOne(@Param('mode') mode: string, @Param('code') code: string) {
    return this.notes.getOne(mode.toUpperCase() as NoteMode, decodeURIComponent(code));
  }

  /** Print a note as PDF. */
  @Get(':mode/:code/print.pdf')
  @Permissions(perm(R, ACTIONS.PRINT))
  async print(@Param('mode') mode: string, @Param('code') code: string, @Res() res: Response) {
    const { buffer, filename } = await this.notes.notePdf(mode.toUpperCase() as NoteMode, decodeURIComponent(code));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  /** Create or re-save a Debit / Credit Note (posts the ledger + clears balances). */
  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Saved a debit / credit note' })
  save(@Body() dto: SaveNoteDto, @CurrentUser('name') userName?: string) {
    return this.notes.save(dto, userName);
  }

  /** Delete a note and reverse all its accounting. */
  @Delete(':mode/:code')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted a debit / credit note' })
  remove(@Param('mode') mode: string, @Param('code') code: string) {
    return this.notes.remove(mode.toUpperCase() as NoteMode, decodeURIComponent(code));
  }
}
