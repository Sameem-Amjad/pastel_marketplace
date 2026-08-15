import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthenticatedRequest } from '../entities/auth.types';

/** UserPermission flags (replaces Sharetribe effectivePermissionSet, doc 06 §6). */
export type PermissionFlag = 'postListings' | 'initiateTx' | 'read';

export const PERMISSION_KEY = 'required_permission';
export const RequirePermission = (flag: PermissionFlag) => SetMetadata(PERMISSION_KEY, flag);

/**
 * Enforces a per-user permission flag (operator-controlled). A missing UserPermission row means the
 * default 'permission/allow'. Used on listing-create (postListings) and checkout/transition (initiateTx).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<PermissionFlag | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!flag) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = req.principal.userId;
    if (!userId) throw new ForbiddenException('Authentication required');

    const perm = await this.prisma.userPermission.findUnique({ where: { userId } });
    const value = perm ? perm[flag] : 'permission/allow';
    if (value === 'permission/deny') {
      throw new ForbiddenException(`Permission denied: ${flag}`);
    }
    return true;
  }
}
