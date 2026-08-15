import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, Prisma, UserRestriction } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../../common/prisma/read-prisma.service';
import { buildPage, decodeCursor, Page } from '../../../common/pagination/cursor.util';
import { AuditService } from './audit.service';
import { AdminUserResource, toAdminUserResource } from '../mappers/admin-user.mapper';
import { AdminResponseMessage } from '../response/response-message';

const USER_SELECT = {
  id: true,
  email: true,
  userType: true,
  accountStatus: true,
  restrictedAt: true,
} satisfies Prisma.UserSelect;

export class AdminUserDetail extends AdminUserResource {
  /** Most-recent 20 restriction-history rows for this user. */
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Most-recent 20 restriction-history rows, newest first.',
  })
  restrictionHistory!: UserRestriction[];
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Keyset-paginated user list (replica). Sort is createdAt DESC with id as the tiebreaker. */
  async list(
    perPage: number,
    cursorToken?: string,
    status?: string,
  ): Promise<Page<AdminUserResource>> {
    const where: Prisma.UserWhereInput = {};
    if (status) where.accountStatus = status as AccountStatus;

    const cursor = cursorToken ? decodeCursor(cursorToken) : null;
    if (cursor) {
      // Seek past the last row of the previous page: (createdAt, id) < (cursor.v, cursor.id).
      where.OR = [
        { createdAt: { lt: new Date(cursor.v) } },
        { createdAt: new Date(cursor.v), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.read.user.findMany({
      where,
      // createdAt is selected only to build the cursor; it is dropped from the response projection.
      select: { ...USER_SELECT, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: perPage + 1,
    });

    const page = buildPage(rows, perPage, (row) => ({
      v: row.createdAt.toISOString(),
      id: row.id,
    }));
    return { ...page, items: page.items.map(toAdminUserResource) };
  }

  async detail(id: string): Promise<AdminUserDetail> {
    const user = await this.read.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException(AdminResponseMessage.fail.USER_NOT_FOUND);

    const restrictionHistory = await this.read.userRestriction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return { ...toAdminUserResource(user), restrictionHistory };
  }

  async restrict(operatorId: string, id: string, reason: string): Promise<AdminUserResource> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, select: { userType: true } });
      if (!existing) throw new NotFoundException(AdminResponseMessage.fail.USER_NOT_FOUND);

      const user = await tx.user.update({
        where: { id },
        data: {
          accountStatus: 'restricted',
          restrictedAt: new Date(),
          restrictionReason: reason,
        },
        select: USER_SELECT,
      });
      await tx.userRestriction.create({
        data: {
          userId: id,
          action: 'restrict',
          reason,
          userType: existing.userType,
          adminActor: operatorId,
        },
      });
      return user;
    });

    await this.audit.log(operatorId, 'user.restrict', 'User', id, { reason });
    return toAdminUserResource(updated);
  }

  async unrestrict(operatorId: string, id: string, reason?: string): Promise<AdminUserResource> {
    const effectiveReason = reason ?? 'unrestricted';
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, select: { userType: true } });
      if (!existing) throw new NotFoundException(AdminResponseMessage.fail.USER_NOT_FOUND);

      const user = await tx.user.update({
        where: { id },
        data: {
          accountStatus: 'active',
          restrictedAt: null,
          restrictionReason: null,
        },
        select: USER_SELECT,
      });
      await tx.userRestriction.create({
        data: {
          userId: id,
          action: 'unrestrict',
          reason: effectiveReason,
          userType: existing.userType,
          adminActor: operatorId,
        },
      });
      return user;
    });

    await this.audit.log(operatorId, 'user.unrestrict', 'User', id, { reason: effectiveReason });
    return toAdminUserResource(updated);
  }

  async ban(operatorId: string, id: string, reason: string): Promise<AdminUserResource> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, select: { userType: true } });
      if (!existing) throw new NotFoundException(AdminResponseMessage.fail.USER_NOT_FOUND);

      const user = await tx.user.update({
        where: { id },
        data: {
          accountStatus: 'banned',
          restrictedAt: new Date(),
          restrictionReason: reason,
        },
        select: USER_SELECT,
      });
      await tx.userRestriction.create({
        data: {
          userId: id,
          action: 'ban',
          reason,
          userType: existing.userType,
          adminActor: operatorId,
        },
      });
      return user;
    });

    await this.audit.log(operatorId, 'user.ban', 'User', id, { reason });
    return toAdminUserResource(updated);
  }
}
