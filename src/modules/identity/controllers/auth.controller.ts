import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AppConfig } from '../../../config/configuration';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { parseCookie } from '../../../common/http/cookies.util';
import {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  ApiTooManyRequestsResponse,
  ApiValidationErrorResponse,
} from '../../../common/swagger/api-envelope.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Principal } from '../entities/auth.types';
import { AuthInfo, AuthService } from '../services/auth.service';
import { AccessTokenResource, SessionResource } from '../response/auth.response';
import { LoginDto, RefreshDto, SignupDto } from '../dto/auth.dto';
import { AuthResponseMessage } from '../response/response-message';
import { TokenPair } from '../services/token.service';
import { toUserResource } from '../mappers/user.mapper';

const ACCESS_COOKIE = 'pa_at';
const REFRESH_COOKIE = 'pa_rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;
  private readonly cookieDomain: string | null;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.isProd = config.get('env', { infer: true }) === 'production';
    this.cookieDomain = config.get('auth', { infer: true }).cookieDomain;
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/auth/signup
   *
   * Description:
   * Registers a new email/password account and starts a session.
   *
   * Used By:
   * React Native Registration screen.
   *
   * Authentication:
   * Public.
   *
   * Response:
   * { status, message, data: { value: SessionResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('signup')
  @ResponseMessage(AuthResponseMessage.success.SIGNUP_COMPLETED)
  @ApiOperation({
    summary: 'Create account',
    description: `
Creates a new user account and signs the caller in.

The endpoint validates the request body, rejects a duplicate email, hashes the password with argon2,
records terms acceptance, stores the user, and issues a token pair.

**Business rules**
- Email must be unique — a duplicate returns \`409\`.
- Email is normalised to lowercase before the uniqueness check.
- Password must be 8–200 characters.

**Tokens**
\`data.value.accessToken\` is returned in the body for the \`Authorization: Bearer\` header. The refresh
token is set as the httpOnly cookie \`pa_rt\` (path \`/auth\`); the Expo app should read it from the
\`Set-Cookie\` response header, keep it in SecureStore, and send it in the \`POST /auth/refresh\` body.

Used by the React Native application during registration.
`,
  })
  @ApiBody({ type: SignupDto, description: 'User registration payload.' })
  @ApiSuccessEnvelope({
    status: HttpStatus.CREATED,
    description: 'Account created and session started.',
    message: AuthResponseMessage.success.SIGNUP_COMPLETED,
    type: SessionResource,
  })
  @ApiValidationErrorResponse()
  @ApiErrorEnvelope(
    HttpStatus.CONFLICT,
    'An account with this email already exists.',
    AuthResponseMessage.fail.EMAIL_ALREADY_EXISTS,
  )
  @ApiTooManyRequestsResponse()
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResource> {
    const { user, tokens } = await this.auth.signup(dto, this.meta(req));
    this.setCookies(res, tokens);
    return {
      user: toUserResource(user),
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/auth/login
   *
   * Description:
   * Exchanges email + password for a session.
   *
   * Used By:
   * React Native Sign-in screen.
   *
   * Authentication:
   * Public. Rate-limited to 10 requests/minute/IP.
   *
   * Response:
   * { status, message, data: { value: SessionResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('login')
  @HttpCode(HttpStatus.OK) // sign-in creates no resource; Nest would default POST to 201
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // brute-force guard (AUDIT H6)
  @ResponseMessage(AuthResponseMessage.success.LOGIN_COMPLETED)
  @ApiOperation({
    summary: 'Sign in',
    description: `
Authenticates an email/password pair and starts a session.

**Business rules**
- An unknown email and a wrong password both return \`401\` with the *same* message — distinguishing
  them would allow account enumeration.
- Banned or deleted accounts return \`403\`.
- Limited to **10 requests per minute per IP**; exceeding it returns \`429\`.

Cookies are set exactly as for signup — see \`POST /auth/signup\`.
`,
  })
  @ApiBody({ type: LoginDto, description: 'Credentials payload.' })
  @ApiSuccessEnvelope({
    description: 'Signed in; session started.',
    message: AuthResponseMessage.success.LOGIN_COMPLETED,
    type: SessionResource,
  })
  @ApiValidationErrorResponse()
  @ApiErrorEnvelope(
    HttpStatus.UNAUTHORIZED,
    'Email or password is wrong.',
    AuthResponseMessage.fail.INVALID_CREDENTIALS,
  )
  @ApiErrorEnvelope(
    HttpStatus.FORBIDDEN,
    'The account is banned or deleted.',
    AuthResponseMessage.fail.ACCOUNT_BANNED,
  )
  @ApiTooManyRequestsResponse()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResource> {
    const { user, tokens } = await this.auth.login(dto, this.meta(req));
    this.setCookies(res, tokens);
    return {
      user: toUserResource(user),
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/auth/refresh
   *
   * Description:
   * Rotates the refresh token and issues a new access token.
   *
   * Used By:
   * React Native token-refresh interceptor (on 401, or shortly before `expiresIn` elapses).
   *
   * Authentication:
   * Refresh token — request body (native) or `pa_rt` cookie (web).
   *
   * Response:
   * { status, message, data: { value: AccessTokenResource, meta } }
   * ------------------------------------------------------------
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AuthResponseMessage.success.TOKEN_REFRESHED)
  @ApiOperation({
    summary: 'Refresh session',
    description: `
Exchanges a refresh token for a new access token.

The refresh token is read from \`refreshToken\` in the body, falling back to the \`pa_rt\` cookie.

**Business rules**
- Refresh tokens **rotate**: the presented token is consumed and a new one is issued.
- Re-presenting an already-rotated token is treated as theft — the whole token family is revoked and
  the user must sign in again.
- No refresh token at all returns \`401\`.
`,
  })
  @ApiBody({
    type: RefreshDto,
    description: 'Refresh payload. Omit the body on web (cookie is used).',
  })
  @ApiSuccessEnvelope({
    description: 'A new access token was issued.',
    message: AuthResponseMessage.success.TOKEN_REFRESHED,
    type: AccessTokenResource,
  })
  @ApiErrorEnvelope(
    HttpStatus.UNAUTHORIZED,
    'Refresh token missing, expired, already rotated, or revoked. Send the user back to sign-in.',
    AuthResponseMessage.fail.REFRESH_TOKEN_INVALID,
  )
  @ApiTooManyRequestsResponse()
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResource> {
    const raw = dto.refreshToken ?? parseCookie(req, REFRESH_COOKIE);
    if (!raw) throw new UnauthorizedException(AuthResponseMessage.fail.REFRESH_TOKEN_MISSING);
    const result = await this.auth.refresh(raw, this.meta(req));
    this.setCookies(res, result);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * POST /api/v1/auth/logout
   *
   * Description:
   * Revokes the refresh token and clears the session cookies.
   *
   * Used By:
   * React Native Settings → Sign out.
   *
   * Authentication:
   * Refresh token — request body (native) or `pa_rt` cookie (web). Never fails on a missing token.
   *
   * Response:
   * { status, message, data: { value: null, meta } }
   * ------------------------------------------------------------
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(AuthResponseMessage.success.LOGOUT_COMPLETED)
  @ApiOperation({
    summary: 'Sign out',
    description: `
Revokes the presented refresh token and clears both session cookies.

**Idempotent** — signing out twice, or without a token, still returns \`200\`. The client should clear
its stored tokens regardless of the outcome.
`,
  })
  @ApiBody({
    type: RefreshDto,
    description: 'Refresh payload. Omit the body on web (cookie is used).',
  })
  @ApiSuccessEnvelope({
    description: 'Session ended.',
    message: AuthResponseMessage.success.LOGOUT_COMPLETED,
  })
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    const raw = dto.refreshToken ?? parseCookie(req, REFRESH_COOKIE);
    await this.auth.logout(raw ?? undefined);
    this.clearCookies(res);
    return null;
  }

  /**
   * ------------------------------------------------------------
   * Endpoint:
   * GET /api/v1/auth/info
   *
   * Description:
   * The boot gate (== sdk.authInfo). Resolve this BEFORE dispatching /me (doc 06).
   *
   * Used By:
   * React Native app bootstrap, to decide between the authed and anonymous navigators.
   *
   * Authentication:
   * Optional — anonymous callers get `isAnonymous: true` rather than a 401.
   *
   * Response:
   * { status, message, data: { value: AuthInfo, meta } }
   * ------------------------------------------------------------
   */
  @Get('info')
  @ResponseMessage(AuthResponseMessage.success.AUTH_INFO_FETCHED)
  @ApiOperation({
    summary: 'Who am I (boot gate)',
    description: `
Reports whether the caller is authenticated and which scopes they hold, without hitting the user table.

Deliberately **never 401s**: an anonymous caller gets \`{ isAnonymous: true, scopes: ['public-read'],
userId: null }\`. The app resolves this first at startup and only then decides whether to call
\`GET /me\`.
`,
  })
  @ApiSuccessEnvelope({
    description: 'Authentication state resolved.',
    message: AuthResponseMessage.success.AUTH_INFO_FETCHED,
    type: AuthInfo,
  })
  info(@CurrentUser() principal: Principal): AuthInfo {
    return this.auth.buildAuthInfo(principal);
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private meta(req: Request): { userAgent?: string; ip?: string } {
    return { userAgent: req.header('user-agent'), ip: req.ip };
  }

  private setCookies(res: Response, tokens: TokenPair): void {
    const base = {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax' as const,
      domain: this.cookieDomain ?? undefined,
    };
    res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.expiresIn * 1000 });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, path: '/auth' });
  }

  private clearCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { domain: this.cookieDomain ?? undefined });
    res.clearCookie(REFRESH_COOKIE, { path: '/auth', domain: this.cookieDomain ?? undefined });
  }
}
