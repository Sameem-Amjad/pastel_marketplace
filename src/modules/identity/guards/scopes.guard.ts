import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, Scope } from '../auth.types';
import { SCOPES_KEY } from '../decorators/scopes.decorator';

/**
 * Enforces the @Scopes(...) declared on a handler/controller (doc 06 §6).
 * No @Scopes → public-read (anyone, including anonymous). The scope hierarchy is:
 *   public-read < user < trusted
 * A caller satisfies a requirement if their scope rank >= the highest required rank.
 */
const RANK: Record<Scope, number> = { 'public-read': 0, user: 1, trusted: 2 };

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Scope[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // public-read

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = req.principal;
    const need = Math.max(...required.map((s) => RANK[s]));

    if (RANK[principal.scope] < need) {
      if (principal.scope === 'public-read') {
        throw new UnauthorizedException('Authentication required');
      }
      throw new ForbiddenException('Insufficient scope');
    }
    return true;
  }
}
