import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AccountDeletionRequest, ContentReport, RestrictionAppeal, Waitlist } from '@prisma/client';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiAuthErrorResponses,
  ApiNotFoundErrorResponse,
  ApiPaginatedEnvelope,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { Page } from '../../../common/pagination/cursor.util';
import { Principal } from '../../identity/entities/auth.types';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { Scopes } from '../../identity/decorators/scopes.decorator';
import { AdminModerationService } from '../services/admin-moderation.service';
import {
  AccountDeletionRequestResource,
  ContentReportResource,
  RestrictionAppealResource,
  WaitlistResource,
} from '../response/admin-moderation.response';
import {
  ListAppealsQueryDto,
  ListDeletionRequestsQueryDto,
  ListReportsQueryDto,
  ListWaitlistQueryDto,
  ResolveReportDto,
  ReviewAppealDto,
} from '../dto/admin-moderation.dto';
import { OperatorGuard } from '../guards/operator.guard';
import { AdminResponseMessage } from '../response/response-message';

/**
 * The four operator moderation queues: content reports, restriction appeals, the launch waitlist, and
 * account-deletion requests.
 *
 * Every route is behind OperatorGuard, every write is audit-logged with the acting operator's id, and
 * every list is keyset-paginated in the same way (`?perPage=&cursor=` → `data.meta.nextCursor`).
 *
 * Not consumed by the React Native marketplace app — these payloads carry reporter emails and appellant
 * details and back the internal admin console only.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(OperatorGuard)
@Scopes('user')
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  // ── content reports ──────────────────────────────────────────────────────────

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/admin/reports
   *
   * Description:
   * The content-report moderation queue.
   *
   * Used By:
   * Internal admin console → Moderation → Reports.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: ContentReportResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get('reports')
  @ResponseMessage(AdminResponseMessage.success.REPORTS_FETCHED)
  @ApiOperation({
    summary: 'List content reports',
    description: `
Lists user-submitted reports, newest first, optionally filtered by \`status\` and \`isDmca\`.

Filter \`isDmca=true\` to work the takedown queue first — DMCA notices carry a legal response clock that
ordinary reports do not.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Report page, plus the cursor for the next one.',
    message: AdminResponseMessage.success.REPORTS_FETCHED,
    type: ContentReportResource,
  })
  @ApiAuthErrorResponses()
  async listReports(@Query() q: ListReportsQueryDto): Promise<Page<ContentReport>> {
    return this.moderation.listReports(q.perPage, q.cursor, q.status, q.isDmca);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/reports/{id}/resolve
   *
   * Description:
   * Records a decision on a content report.
   *
   * Used By:
   * Internal admin console → Moderation → Reports → Resolve.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: ContentReportResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('reports/:id/resolve')
  @HttpCode(HttpStatus.OK) // status change on an existing report
  @ResponseMessage(AdminResponseMessage.success.REPORT_RESOLVED)
  @ApiOperation({
    summary: 'Resolve content report',
    description: `
Moves the report to a terminal \`status\` and stores the operator note.

Resolving is a bookkeeping action: it records the decision and audit trail but does **not** itself
remove content or restrict the reported user — do those through the listing and user endpoints.
`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Content report id.' })
  @ApiBody({ type: ResolveReportDto, description: 'Decision and optional operator note.' })
  @ApiSuccessEnvelope({
    description: 'Report resolved.',
    message: AdminResponseMessage.success.REPORT_RESOLVED,
    type: ContentReportResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.REPORT_NOT_FOUND)
  async resolveReport(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<ContentReport> {
    return this.moderation.resolveReport(me.userId!, id, dto.status, dto.note);
  }

  // ── restriction appeals ──────────────────────────────────────────────────────

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/admin/appeals
   *
   * Description:
   * The restriction-appeal queue.
   *
   * Used By:
   * Internal admin console → Moderation → Appeals.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: RestrictionAppealResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get('appeals')
  @ResponseMessage(AdminResponseMessage.success.APPEALS_FETCHED)
  @ApiOperation({
    summary: 'List restriction appeals',
    description: `
Lists appeals from restricted users, newest first, optionally filtered by \`status\`
(\`pending\` is the working queue).

Each row carries the original \`restrictionReason\` alongside the appellant's case, so a decision can be
made without opening the user record.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Appeal page, plus the cursor for the next one.',
    message: AdminResponseMessage.success.APPEALS_FETCHED,
    type: RestrictionAppealResource,
  })
  @ApiAuthErrorResponses()
  async listAppeals(@Query() q: ListAppealsQueryDto): Promise<Page<RestrictionAppeal>> {
    return this.moderation.listAppeals(q.perPage, q.cursor, q.status);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/appeals/{id}/review
   *
   * Description:
   * Records a decision on a restriction appeal.
   *
   * Used By:
   * Internal admin console → Moderation → Appeals → Review.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: RestrictionAppealResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('appeals/:id/review')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AdminResponseMessage.success.APPEAL_REVIEWED)
  @ApiOperation({
    summary: 'Review restriction appeal',
    description: `
Stamps the appeal with a decision, the reviewing operator, and \`reviewedAt\`.

**Business rules**
- \`adminNote\` is **required** — every appeal decision must be justified in the audit trail.
- Upholding an appeal does **not** automatically lift the restriction: call
  \`POST /admin/users/{id}/unrestrict\` as the follow-up action.
`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Appeal id.' })
  @ApiBody({ type: ReviewAppealDto, description: 'Decision and mandatory reasoning.' })
  @ApiSuccessEnvelope({
    description: 'Appeal reviewed.',
    message: AdminResponseMessage.success.APPEAL_REVIEWED,
    type: RestrictionAppealResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.APPEAL_NOT_FOUND)
  async reviewAppeal(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAppealDto,
  ): Promise<RestrictionAppeal> {
    return this.moderation.reviewAppeal(me.userId!, id, dto.status, dto.adminNote);
  }

  // ── waitlist ─────────────────────────────────────────────────────────────────

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/admin/waitlist
   *
   * Description:
   * The launch waitlist queue.
   *
   * Used By:
   * Internal admin console → Waitlist.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: WaitlistResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get('waitlist')
  @ResponseMessage(AdminResponseMessage.success.WAITLIST_FETCHED)
  @ApiOperation({
    summary: 'List waitlist',
    description: `
Lists waitlist entries, newest first, optionally filtered by \`status\`.

\`priority\` and \`referralCount\` are the signals for who to admit next; sorting is still by recency, so
filter and scan rather than expecting a ranked queue.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Waitlist page, plus the cursor for the next one.',
    message: AdminResponseMessage.success.WAITLIST_FETCHED,
    type: WaitlistResource,
  })
  @ApiAuthErrorResponses()
  async listWaitlist(@Query() q: ListWaitlistQueryDto): Promise<Page<Waitlist>> {
    return this.moderation.listWaitlist(q.perPage, q.cursor, q.status);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/waitlist/{id}/approve
   *
   * Description:
   * Approves a waitlist entry for onboarding.
   *
   * Used By:
   * Internal admin console → Waitlist → Approve.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: WaitlistResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('waitlist/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AdminResponseMessage.success.WAITLIST_APPROVED)
  @ApiOperation({
    summary: 'Approve waitlist entry',
    description: `
Marks the entry approved and audit-logs the acting operator.

This clears the entry for onboarding; it does not itself create an account — the invitee still signs up
through \`POST /auth/signup\`.
`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Waitlist entry id.' })
  @ApiSuccessEnvelope({
    description: 'Waitlist entry approved.',
    message: AdminResponseMessage.success.WAITLIST_APPROVED,
    type: WaitlistResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.WAITLIST_ENTRY_NOT_FOUND)
  async approveWaitlist(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Waitlist> {
    return this.moderation.approveWaitlist(me.userId!, id);
  }

  // ── account deletion requests ─────────────────────────────────────────────────

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/admin/deletion-requests
   *
   * Description:
   * The account-deletion request queue (GDPR/CCPA).
   *
   * Used By:
   * Internal admin console → Privacy → Deletion requests.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AccountDeletionRequestResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get('deletion-requests')
  @ResponseMessage(AdminResponseMessage.success.DELETION_REQUESTS_FETCHED)
  @ApiOperation({
    summary: 'List deletion requests',
    description: `
Lists account-deletion requests, newest first, optionally filtered by \`status\`
(\`pending\` or \`completed\`).

These carry a statutory response deadline — work the \`pending\` filter, and note \`userId\` may be null
when the requesting email matched no account.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'Deletion-request page, plus the cursor for the next one.',
    message: AdminResponseMessage.success.DELETION_REQUESTS_FETCHED,
    type: AccountDeletionRequestResource,
  })
  @ApiAuthErrorResponses()
  async listDeletionRequests(
    @Query() q: ListDeletionRequestsQueryDto,
  ): Promise<Page<AccountDeletionRequest>> {
    return this.moderation.listDeletionRequests(q.perPage, q.cursor, q.status);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/deletion-requests/{id}/complete
   *
   * Description:
   * Marks a deletion request as carried out.
   *
   * Used By:
   * Internal admin console → Privacy → Deletion requests → Complete.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AccountDeletionRequestResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('deletion-requests/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AdminResponseMessage.success.DELETION_REQUEST_COMPLETED)
  @ApiOperation({
    summary: 'Complete deletion request',
    description: `
Stamps \`completedAt\`, records the resolution, and audit-logs the acting operator.

This closes the request record — it is the bookkeeping step confirming the erasure was performed, not
the erasure itself.
`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Deletion request id.' })
  @ApiSuccessEnvelope({
    description: 'Deletion request marked complete.',
    message: AdminResponseMessage.success.DELETION_REQUEST_COMPLETED,
    type: AccountDeletionRequestResource,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.DELETION_REQUEST_NOT_FOUND)
  async completeDeletionRequest(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountDeletionRequest> {
    return this.moderation.completeDeletionRequest(me.userId!, id);
  }
}
