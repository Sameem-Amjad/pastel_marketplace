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
import { AdminUserDetail, AdminUsersService } from '../services/admin-users.service';
import { AdminUserResource } from '../mappers/admin-user.mapper';
import {
  BanUserDto,
  ListUsersQueryDto,
  RestrictUserDto,
  UnrestrictUserDto,
} from '../dto/admin-users.dto';
import { OperatorGuard } from '../guards/operator.guard';
import { AdminResponseMessage } from '../response/response-message';

/** Target user path param, shared by every route below. */
const USER_PARAM = {
  name: 'id',
  format: 'uuid',
  example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  description: 'The user being administered.',
} as const;

/**
 * Operator-only user administration. Every route is behind OperatorGuard, and every write is recorded
 * in the audit log with the acting operator's id.
 *
 * Not consumed by the React Native marketplace app — this surface backs the internal admin console.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(OperatorGuard)
@Scopes('user')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/admin/users
   *
   * Description:
   * Keyset-paginated user list, optionally filtered by account status.
   *
   * Used By:
   * Internal admin console → Users.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AdminUserResource[], meta: { perPage, count, nextCursor, hasNext, hasPrevious } } }
   * ------------------------------------------------------------
   */
  @Get()
  @ResponseMessage(AdminResponseMessage.success.USERS_FETCHED)
  @ApiOperation({
    summary: 'List users',
    description: `
Lists users newest-first, optionally filtered by \`status\`.

Cursor-paginated: echo \`data.meta.nextCursor\` as \`?cursor=\`. Served from the read replica, so a
just-applied restriction may take a moment to appear in the list — the detail endpoint is authoritative.

Rows carry email but never password hashes or the private/protected data buckets.
`,
  })
  @ApiPaginatedEnvelope({
    description: 'User page, plus the cursor for the next one.',
    message: AdminResponseMessage.success.USERS_FETCHED,
    type: AdminUserResource,
  })
  @ApiAuthErrorResponses()
  async list(@Query() q: ListUsersQueryDto): Promise<Page<AdminUserResource>> {
    return this.users.list(q.perPage, q.cursor, q.status);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/admin/users/{id}
   *
   * Description:
   * One user plus their recent restriction history.
   *
   * Used By:
   * Internal admin console → User detail.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AdminUserDetail, meta } }
   * ------------------------------------------------------------
   */
  @Get(':id')
  @ResponseMessage(AdminResponseMessage.success.USER_FETCHED)
  @ApiOperation({
    summary: 'Get user',
    description: `
Returns one user together with their 20 most recent restriction-history rows, newest first — the
context an operator needs before acting.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiSuccessEnvelope({
    description: 'User fetched with restriction history.',
    message: AdminResponseMessage.success.USER_FETCHED,
    type: AdminUserDetail,
  })
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.USER_NOT_FOUND)
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
    return this.users.detail(id);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/users/{id}/restrict
   *
   * Description:
   * Restricts an account (reversible).
   *
   * Used By:
   * Internal admin console → User detail → Restrict.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AdminUserResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/restrict')
  @HttpCode(HttpStatus.OK) // status change, not a creation
  @ResponseMessage(AdminResponseMessage.success.USER_RESTRICTED)
  @ApiOperation({
    summary: 'Restrict user',
    description: `
Sets \`accountStatus\` to \`restricted\`, stamps \`restrictedAt\`, and records the reason.

**Business rules**
- \`reason\` is required — it is written to the restriction history and shown to the user if they appeal.
- The status change and the history row are written in one transaction, so an audit trail can never go
  missing.
- Reversible via \`POST /admin/users/{id}/unrestrict\`.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiBody({ type: RestrictUserDto, description: 'Why the account is being restricted.' })
  @ApiSuccessEnvelope({
    description: 'User restricted.',
    message: AdminResponseMessage.success.USER_RESTRICTED,
    type: AdminUserResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.USER_NOT_FOUND)
  async restrict(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestrictUserDto,
  ): Promise<AdminUserResource> {
    return this.users.restrict(me.userId!, id, dto.reason);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/users/{id}/unrestrict
   *
   * Description:
   * Lifts a restriction and returns the account to `active`.
   *
   * Used By:
   * Internal admin console → User detail → Unrestrict.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AdminUserResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/unrestrict')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AdminResponseMessage.success.USER_UNRESTRICTED)
  @ApiOperation({
    summary: 'Unrestrict user',
    description: `
Returns the account to \`active\` and clears \`restrictedAt\` / \`restrictionReason\`.

\`reason\` is optional here and defaults to \`"unrestricted"\` in the history row. Note this also clears
a **ban**, since ban and restriction share the same status field — check the current status first.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiBody({ type: UnrestrictUserDto, description: 'Optional reason for lifting the restriction.' })
  @ApiSuccessEnvelope({
    description: 'Restriction lifted; the account is active.',
    message: AdminResponseMessage.success.USER_UNRESTRICTED,
    type: AdminUserResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.USER_NOT_FOUND)
  async unrestrict(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnrestrictUserDto,
  ): Promise<AdminUserResource> {
    return this.users.unrestrict(me.userId!, id, dto.reason);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/admin/users/{id}/ban
   *
   * Description:
   * Bans an account.
   *
   * Used By:
   * Internal admin console → User detail → Ban.
   *
   * Authentication:
   * Bearer token, `user` scope, operator privileges.
   *
   * Response:
   * { status, message, data: { value: AdminUserResource, meta } }
   * ------------------------------------------------------------
   */
  @Post(':id/ban')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AdminResponseMessage.success.USER_BANNED)
  @ApiOperation({
    summary: 'Ban user',
    description: `
Sets \`accountStatus\` to \`banned\` and records the reason in the restriction history.

**Business rules**
- \`reason\` is required.
- A banned account can no longer sign in — \`POST /auth/login\` returns \`403\` for it.
- Existing sessions are not force-revoked here; the ban takes effect at the next token refresh.
- Reversible via \`POST /admin/users/{id}/unrestrict\`.
`,
  })
  @ApiParam(USER_PARAM)
  @ApiBody({ type: BanUserDto, description: 'Why the account is being banned.' })
  @ApiSuccessEnvelope({
    description: 'User banned.',
    message: AdminResponseMessage.success.USER_BANNED,
    type: AdminUserResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  @ApiNotFoundErrorResponse(AdminResponseMessage.fail.USER_NOT_FOUND)
  async ban(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BanUserDto,
  ): Promise<AdminUserResource> {
    return this.users.ban(me.userId!, id, dto.reason);
  }
}
