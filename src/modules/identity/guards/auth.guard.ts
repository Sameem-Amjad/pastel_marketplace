import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../../../config/configuration';
import { parseCookie } from '../../../common/http/cookies.util';
import { ANONYMOUS, AuthenticatedRequest, Principal } from '../entities/auth.types';
import { TokenService } from '../services/token.service';

/**
 * Resolves the caller into req.principal on EVERY request (doc 06 §2, §6).
 *
 * Dual transport, in precedence order:
 *   1. X-Native-Token header  — Capacitor/WKWebView can't share the web cookie jar.
 *   2. Authorization: Bearer  — generic API clients.
 *   3. pa_at cookie           — web/SSR.
 * Native/bearer are checked BEFORE the cookie so a stale anonymous cookie can never shadow a valid
 * user token (a recurring historical bug called out in doc 06).
 *
 * Never rejects on its own: a missing token → anonymous principal. ScopesGuard does the 401/403. The one
 * exception: a token that is PRESENT but invalid/expired → 401, so the client refreshes instead of
 * silently degrading to anonymous and getting confusing 403s.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly tokens: TokenService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('auth', { infer: true }).cookieName;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = this.extractToken(req);

    if (!raw) {
      req.principal = ANONYMOUS;
      return true;
    }

    const claims = this.tokens.verifyAccess(raw); // throws 401 if present-but-invalid
    const principal: Principal = {
      userId: claims.sub,
      scope: claims.scope,
      userType: claims.userType,
    };
    req.principal = principal;
    return true;
  }

  private extractToken(req: Request): string | null {
    const native = req.header('X-Native-Token');
    if (native) return native;

    const authz = req.header('Authorization');
    if (authz?.startsWith('Bearer ')) return authz.slice(7);

    return parseCookie(req, this.cookieName);
  }
}
