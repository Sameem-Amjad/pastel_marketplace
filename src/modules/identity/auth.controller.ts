import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { parseCookie } from '../../common/http/cookies.util';
import { CurrentUser } from './decorators/current-user.decorator';
import { Principal } from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, SignupDto } from './dto/auth.dto';
import { TokenPair } from './services/token.service';
import { toUserResource, UserResource } from './user.mapper';

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

  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserResource; accessToken: string; expiresIn: number }> {
    const { user, tokens } = await this.auth.signup(dto, this.meta(req));
    this.setCookies(res, tokens);
    return { user: toUserResource(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // brute-force guard (AUDIT H6)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserResource; accessToken: string; expiresIn: number }> {
    const { user, tokens } = await this.auth.login(dto, this.meta(req));
    this.setCookies(res, tokens);
    return { user: toUserResource(user), accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const raw = dto.refreshToken ?? parseCookie(req, REFRESH_COOKIE);
    if (!raw) throw new UnauthorizedException('No refresh token');
    const result = await this.auth.refresh(raw, this.meta(req));
    this.setCookies(res, result);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('logout')
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const raw = dto.refreshToken ?? parseCookie(req, REFRESH_COOKIE);
    await this.auth.logout(raw ?? undefined);
    this.clearCookies(res);
    return { ok: true };
  }

  /** The boot gate (== sdk.authInfo). Frontend resolves this BEFORE dispatching /me (doc 06). */
  @Get('info')
  info(@CurrentUser() principal: Principal) {
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
