import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AgentCommissionService } from './agent-commission.service';
import {
  AgentCommissionQueryDto,
  ChequeTimingQueryDto,
  CreateBankBounceChargeDto,
  CreateBounceEventDto,
  CreateCoverDto,
  CreateRateDto,
  CreateSettlementDto,
  BulkSpecialCommissionDto,
  CreateSpecialCommissionDto,
  PaySettlementDto,
  RateImpactQueryDto,
  TestRateQueryDto,
} from './dto/agent-commission.dto';

const R = RESOURCES.AGENT_COMMISSION;

@ApiTags('Agent commission')
@ApiBearerAuth()
@Controller('agent-commission')
export class AgentCommissionController {
  constructor(private readonly svc: AgentCommissionService) {}

  /* ── Rate master ──────────────────────────────────────────────────────── */
  // Rates are money, so reading them needs `viewrates`, not plain `view`.

  /** The agent × category grid the rates screen is built on. */
  @Get('rates/coverage')
  @Permissions(perm(R, ACTIONS.VIEWRATES))
  rateCoverage() {
    return this.svc.rateCoverage();
  }

  @Get('rates')
  @Permissions(perm(R, ACTIONS.VIEWRATES))
  rates(@Query('agentId') agentId?: string) {
    return this.svc.listRates(agentId ? Number(agentId) : undefined);
  }

  /** How many invoices a rate dated X would price, and how many it would miss. */
  @Get('rates/impact')
  @Permissions(perm(R, ACTIONS.VIEWRATES))
  rateImpact(@Query() q: RateImpactQueryDto) {
    return this.svc.rateImpact(q);
  }

  @Post('rates')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Set an agent commission rate' })
  createRate(@Body() dto: CreateRateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createRate(dto, user.name);
  }

  /* ── Special Commission ───────────────────────────────────────────────── */
  //
  // Declared before 'rates/:id' so "special" is matched as a route rather than
  // parsed as a rate id. Same permissions as the base rate master: it IS the
  // rate master, only aimed more narrowly.
  @Get('rates/special')
  @Permissions(perm(R, ACTIONS.VIEWRATES))
  specials(@Query('agentId') agentId?: string) {
    return this.svc.listSpecials(agentId ? Number(agentId) : undefined);
  }

  /**
   * What the New Order form needs to fold this customer's agent commission into
   * Product ₹: the agent's current special rules plus their base rates, each
   * carrying its own `addToRate` flag.
   *
   * Deliberately NOT gated on `agentcommission:viewrates`: once a rate is
   * flagged `addToRate`, its figure is no longer commission-internal — it IS
   * the price an order-taker is about to charge, so anyone who can see a
   * party's Special Rate (the equivalent customer-facing adjustment) can see
   * this too.
   */
  @Get('rates/customer-add-ons/:customerId')
  @AnyPermission(perm(RESOURCES.SPECIAL_RATE, ACTIONS.VIEW), perm(R, ACTIONS.VIEWRATES))
  addOnsForCustomer(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.svc.listAddOnsForCustomer(customerId);
  }

  /** "What rate would apply here?" — resolved by the same code that prices an
   *  invoice, so the answer cannot drift from the money. */
  @Get('rates/special/test')
  @Permissions(perm(R, ACTIONS.VIEWRATES))
  testRate(@Query() q: TestRateQueryDto) {
    return this.svc.testRate(q);
  }

  @Post('rates/special')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Set a special agent commission rate' })
  createSpecial(@Body() dto: CreateSpecialCommissionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createSpecial(dto, user.name);
  }

  /** The same special rule for several parties — one request, one re-price. */
  @Post('rates/special/bulk')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Bulk-added an agent special commission rate' })
  createSpecialBulk(@Body() dto: BulkSpecialCommissionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createSpecialBulk(dto, user?.name ?? null);
  }

  @Delete('rates/special/:id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Removed a special agent commission rate' })
  deleteSpecial(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteSpecial(id);
  }

  @Delete('rates/:id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Removed an agent commission rate' })
  deleteRate(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteRate(id);
  }

  /* ── Accruals ─────────────────────────────────────────────────────────── */

  @Get('accruals')
  @Permissions(perm(R, ACTIONS.VIEW))
  accruals(@Query() q: AgentCommissionQueryDto) {
    return this.svc.accruals(q);
  }

  /** Re-derive one invoice's commission — used after a challan is edited. */
  @Post('accruals/rebuild/:challanId')
  @Permissions(perm(R, ACTIONS.UPDATE))
  rebuild(@Param('challanId', ParseIntPipe) challanId: number) {
    return this.svc.rebuildForChallan(challanId).then((accruals) => ({ accruals }));
  }

  /** Bulk re-derive. Run once after first filling in the rate master, since
   *  invoices raised before it existed would otherwise never accrue. */
  @Post('accruals/backfill')
  @Permissions(perm(R, ACTIONS.MANAGE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Backfilled agent commission accruals' })
  backfill(@Body() body: { dateFrom?: string; dateTo?: string }) {
    return this.svc.backfill(body?.dateFrom, body?.dateTo);
  }

  /* ── Agent covering a defaulting party ────────────────────────────────── */

  @Get('covers')
  @Permissions(perm(R, ACTIONS.VIEW))
  covers(@Query('agentId') agentId?: string, @Query('status') status?: string) {
    return this.svc.listCovers(agentId ? Number(agentId) : undefined, status);
  }

  @Post('covers')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Recorded an agent-covered party amount' })
  createCover(@Body() dto: CreateCoverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createCover(dto, user.name);
  }

  @Post('covers/:id/recover')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Marked an agent cover recovered' })
  recoverCover(@Param('id', ParseIntPipe) id: number, @Body() body: { via?: string }) {
    return this.svc.recoverCover(id, body?.via);
  }

  /* ── Cheque bounce ────────────────────────────────────────────────────── */

  @Get('bank-charges')
  @Permissions(perm(R, ACTIONS.VIEW))
  bankCharges() {
    return this.svc.bankCharges();
  }

  @Post('bank-charges')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Set a bank cheque-bounce charge' })
  upsertBankCharge(@Body() dto: CreateBankBounceChargeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.upsertBankCharge(dto, user.name);
  }

  @Get('bounces')
  @Permissions(perm(R, ACTIONS.VIEW))
  bounces(@Query('chequeId') chequeId?: string, @Query('agentId') agentId?: string) {
    return this.svc.listBounces(chequeId ? Number(chequeId) : undefined, agentId ? Number(agentId) : undefined);
  }

  @Post('bounces')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Recorded a cheque bounce' })
  createBounce(@Body() dto: CreateBounceEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createBounce(dto, user.name);
  }

  @Delete('bounces/:id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R, description: 'Removed a cheque bounce record' })
  deleteBounce(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteBounce(id);
  }

  /* ── Cheque timing (§7) ───────────────────────────────────────────────── */

  /** Is this cheque dated later than the party's money was due? Answered for a
   *  cheque that hasn't been saved yet, so the owner can push back on the spot. */
  @Get('cheque-timing')
  @Permissions(perm(R, ACTIONS.VIEW))
  chequeTiming(@Query() q: ChequeTimingQueryDto) {
    return this.svc.chequeTiming(q);
  }

  @Get('cheque-timing/:chequeId')
  @Permissions(perm(R, ACTIONS.VIEW))
  chequeTimingFor(@Param('chequeId', ParseIntPipe) chequeId: number) {
    return this.svc.chequeTimingFor(chequeId);
  }

  /* ── Settlement ───────────────────────────────────────────────────────── */

  /** What the settlement WOULD be — nothing is written. */
  @Get('settlements/preview')
  @Permissions(perm(R, ACTIONS.VIEWRATES))
  preview(@Query('agentId', ParseIntPipe) agentId: number, @Query('periodFrom') from: string, @Query('periodTo') to: string) {
    return this.svc.preview(agentId, from, to);
  }

  @Get('settlements')
  @Permissions(perm(R, ACTIONS.VIEW))
  settlements(@Query('agentId') agentId?: string, @Query('status') status?: string) {
    return this.svc.listSettlements(agentId ? Number(agentId) : undefined, status);
  }

  @Get('settlements/:id')
  @Permissions(perm(R, ACTIONS.VIEW))
  settlement(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getSettlement(id);
  }

  @Post('settlements')
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R, description: 'Drafted an agent commission settlement' })
  createSettlement(@Body() dto: CreateSettlementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.createSettlement(dto, user.name);
  }

  /** The point money leaves — deliberately its own permission, so preparing a
   *  settlement and actually paying it can be different people. */
  @Post('settlements/:id/pay')
  @Permissions(perm(R, ACTIONS.SETTLE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Paid an agent commission settlement' })
  paySettlement(@Param('id', ParseIntPipe) id: number, @Body() dto: PaySettlementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.paySettlement(id, dto, user.name);
  }

  @Post('settlements/:id/cancel')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Cancelled an agent commission settlement' })
  cancelSettlement(@Param('id', ParseIntPipe) id: number) {
    return this.svc.cancelSettlement(id);
  }
}
