import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import {
  ApiAuthErrorResponses,
  ApiSuccessEnvelope,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthService } from '../services/auth.service';
import { Principal } from '../entities/auth.types';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Scopes } from '../decorators/scopes.decorator';
import { UpdateMeDto } from '../dto/auth.dto';
import { AuthResponseMessage } from '../response/response-message';
import { toUserResource, UserResource } from '../mappers/user.mapper';

/** Current-user surface (== sdk.currentUser.show / updateProfile, doc 06). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@Scopes('user')
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/me
   *
   * Description:
   * Returns the signed-in user's own profile.
   *
   * Used By:
   * React Native app bootstrap (after `GET /auth/info`) and the Profile screen.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: UserResource, meta } }
   * ------------------------------------------------------------
   */
  @Get()
  @ResponseMessage(AuthResponseMessage.success.PROFILE_FETCHED)
  @ApiOperation({
    summary: 'Get my profile',
    description: `
Returns the full profile of the authenticated user.

This is the caller's *own* record, so it includes \`email\` and verification flags that the public
projections omit. Password hashes and the \`privateData\`/\`protectedData\` buckets never leave the
server.

A valid token whose user no longer exists returns \`401\` (the credential is what became invalid), not
\`404\`.
`,
  })
  @ApiSuccessEnvelope({
    description: 'Profile fetched.',
    message: AuthResponseMessage.success.PROFILE_FETCHED,
    type: UserResource,
  })
  @ApiAuthErrorResponses()
  async show(@CurrentUser() principal: Principal): Promise<UserResource> {
    const user = await this.auth.me(principal.userId!);
    return toUserResource(user);
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * PATCH /api/v1/me
   *
   * Description:
   * Partially updates the signed-in user's profile.
   *
   * Used By:
   * React Native Edit-profile screen.
   *
   * Authentication:
   * Bearer token, `user` scope.
   *
   * Response:
   * { status, message, data: { value: UserResource, meta } }
   * ------------------------------------------------------------
   */
  @Patch()
  @ResponseMessage(AuthResponseMessage.success.PROFILE_UPDATED)
  @ApiOperation({
    summary: 'Update my profile',
    description: `
Updates the authenticated user's editable profile fields and returns the fresh record.

**Business rules**
- Every field is optional; an omitted field is left untouched, so the client can PATCH a single input.
- Only the fields in \`UpdateMeDto\` are writable here — email, account status and permissions are not
  self-serve.
- Unknown properties in the body are stripped by the global validation pipe.
`,
  })
  @ApiBody({ type: UpdateMeDto, description: 'Profile fields to change. Send only what changed.' })
  @ApiSuccessEnvelope({
    description: 'Profile updated.',
    message: AuthResponseMessage.success.PROFILE_UPDATED,
    type: UserResource,
  })
  @ApiValidationErrorResponse()
  @ApiAuthErrorResponses()
  async update(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResource> {
    const user = await this.prisma.user.update({
      where: { id: principal.userId! },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName,
        bio: dto.bio,
        aboutShop: dto.aboutShop,
      },
    });
    return toUserResource(user);
  }
}
