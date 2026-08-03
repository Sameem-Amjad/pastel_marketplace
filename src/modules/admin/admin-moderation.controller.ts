import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccountDeletionRequest,
  ContentReport,
  RestrictionAppeal,
  Waitlist,
} from '@prisma/client';
import { Page } from '../../common/pagination/cursor.util';
import { Principal } from '../identity/auth.types';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Scopes } from '../identity/decorators/scopes.decorator';
import { AdminModerationService } from './admin-moderation.service';
import {
  ListAppealsQueryDto,
  ListDeletionRequestsQueryDto,
  ListReportsQueryDto,
  ListWaitlistQueryDto,
  ResolveReportDto,
  ReviewAppealDto,
} from './dto/admin-moderation.dto';
import { OperatorGuard } from './guards/operator.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(OperatorGuard)
@Scopes('user')
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  // ── content reports ──────────────────────────────────────────────────────────
  @Get('reports')
  async listReports(@Query() q: ListReportsQueryDto): Promise<Page<ContentReport>> {
    return this.moderation.listReports(q.perPage, q.cursor, q.status, q.isDmca);
  }

  @Post('reports/:id/resolve')
  async resolveReport(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<ContentReport> {
    return this.moderation.resolveReport(me.userId!, id, dto.status, dto.note);
  }

  // ── restriction appeals ──────────────────────────────────────────────────────
  @Get('appeals')
  async listAppeals(@Query() q: ListAppealsQueryDto): Promise<Page<RestrictionAppeal>> {
    return this.moderation.listAppeals(q.perPage, q.cursor, q.status);
  }

  @Post('appeals/:id/review')
  async reviewAppeal(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAppealDto,
  ): Promise<RestrictionAppeal> {
    return this.moderation.reviewAppeal(me.userId!, id, dto.status, dto.adminNote);
  }

  // ── waitlist ─────────────────────────────────────────────────────────────────
  @Get('waitlist')
  async listWaitlist(@Query() q: ListWaitlistQueryDto): Promise<Page<Waitlist>> {
    return this.moderation.listWaitlist(q.perPage, q.cursor, q.status);
  }

  @Post('waitlist/:id/approve')
  async approveWaitlist(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Waitlist> {
    return this.moderation.approveWaitlist(me.userId!, id);
  }

  // ── account deletion requests ─────────────────────────────────────────────────
  @Get('deletion-requests')
  async listDeletionRequests(
    @Query() q: ListDeletionRequestsQueryDto,
  ): Promise<Page<AccountDeletionRequest>> {
    return this.moderation.listDeletionRequests(q.perPage, q.cursor, q.status);
  }

  @Post('deletion-requests/:id/complete')
  async completeDeletionRequest(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountDeletionRequest> {
    return this.moderation.completeDeletionRequest(me.userId!, id);
  }
}
