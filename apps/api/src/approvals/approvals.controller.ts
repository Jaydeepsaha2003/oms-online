import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES, type ApprovalQuery } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ApprovalsService } from './approvals.service';
import { ApprovalDecisionDto, ApprovalQueryDto } from './dto/approval.dto';

const R = RESOURCES.APPROVAL;

@ApiTags('Approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** Just the pending badge number — cheap enough for the sidebar to poll. */
  @Get('count')
  @Permissions(perm(R, ACTIONS.VIEW))
  count() {
    return this.approvals.pendingCount();
  }

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: ApprovalQueryDto) {
    return this.approvals.list(query as unknown as ApprovalQuery);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  byId(@Param('id', ParseIntPipe) id: number) {
    return this.approvals.byId(id);
  }

  /** Sign the request off — this is what actually performs the held-back action. */
  @Post(':id/approve')
  @Permissions(perm(R, ACTIONS.APPROVE))
  @Audit({ action: ACTIONS.APPROVE, resource: R, description: 'Approved a pending request' })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvals.approve(id, { id: Number(user.id) || null, name: user.name }, dto.note);
  }

  @Post(':id/reject')
  @Permissions(perm(R, ACTIONS.APPROVE))
  @Audit({ action: ACTIONS.APPROVE, resource: R, description: 'Rejected a pending request' })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvals.reject(id, { id: Number(user.id) || null, name: user.name }, dto.note);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Deleted an approval request' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.approvals.remove(id);
    return { ok: true };
  }
}
