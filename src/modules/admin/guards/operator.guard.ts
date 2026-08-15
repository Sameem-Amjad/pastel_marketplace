import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedRequest } from '../../identity/entities/auth.types';

/**
 * Operator (Admin/Ops) gate. Enforces TWO things:
 *   (a) the caller is authenticated — req.principal.userId must be set, else 401; and
 *   (b) an operator credential — header `X-Operator-Secret` must equal the configured operator secret
 *       (replaces the legacy x-admin-secret).
 *
 * The secret comes from typed config (not a raw process.env read) and is compared in CONSTANT TIME so the
 * comparison can't be used as a timing oracle to recover the secret byte-by-byte (AUDIT H2). If no secret
 * is configured, or the header is missing/mismatched, we deny (403). The operator id used as the audit
 * `actor` is req.principal.userId. Apply alongside @Scopes('user').
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  private readonly secret: string | null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.secret = config.get('admin', { infer: true }).operatorSecret;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!req.principal.userId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!this.secret || !this.constantTimeEquals(req.header('X-Operator-Secret'), this.secret)) {
      throw new ForbiddenException('Operator credential required');
    }
    return true;
  }

  private constantTimeEquals(provided: string | undefined, expected: string): boolean {
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual requires equal-length buffers; comparing lengths first leaks only the length,
    // which is not the secret. Hash-then-compare would also work but this is sufficient here.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
