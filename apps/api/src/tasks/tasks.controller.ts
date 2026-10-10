import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { CreateTaskInput, UpdateTaskInput } from '@oms/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { MAX_TASK_FILE_BYTES, TasksService } from './tasks.service';

/** Tasks & Bugs. Open to everyone signed in (the global JwtAuthGuard); only
 *  completing one needs `task:approve`, checked in the service. */
@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() me: AuthenticatedUser) {
    return this.tasks.list(me);
  }

  @Post()
  create(@Body() body: CreateTaskInput, @CurrentUser() me: AuthenticatedUser) {
    return this.tasks.create(body, me);
  }

  /** Always a download: an uploaded HTML or SVG must never open as a page here. */
  @Get('files/:fileId')
  async download(@Param('fileId', ParseIntPipe) fileId: number, @Res({ passthrough: true }) res: Response) {
    const { file, content } = await this.tasks.readFile(fileId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(content);
  }

  @Delete('files/:fileId')
  removeFile(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() me: AuthenticatedUser) {
    return this.tasks.removeFile(fileId, me);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateTaskInput, @CurrentUser() me: AuthenticatedUser) {
    return this.tasks.update(id, body, me);
  }

  @Post(':id/complete')
  complete(@Param('id', ParseIntPipe) id: number, @Body() body: { resolution?: string; notify?: boolean }, @CurrentUser() me: AuthenticatedUser) {
    return this.tasks.complete(id, body, me);
  }

  @Post(':id/reopen')
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentUser() me: AuthenticatedUser) {
    return this.tasks.reopen(id, me);
  }

  @Post(':id/comments')
  comment(@Param('id', ParseIntPipe) id: number, @Body() body: { text?: string; withFiles?: boolean }, @CurrentUser() me: AuthenticatedUser) {
    return this.tasks.comment(id, body, me);
  }

  @Post(':id/files')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_TASK_FILE_BYTES, files: 1 } }))
  addFile(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() me: AuthenticatedUser,
    @Query('eventId') eventId?: string,
  ) {
    return this.tasks.addFile(id, eventId ? Number(eventId) : null, file, me);
  }
}
