import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../common/prisma/read-prisma.service';
import { OutboxService, OutboxTopic } from '../../common/outbox/outbox.service';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { buildPage, decodeCursor, Page } from '../../common/pagination/cursor.util';
import { PublicUserResource, PUBLIC_USER_SELECT, toPublicUserResource } from './social.mapper';

@Injectable()
export class FollowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Follow a user. Idempotent: re-following is a no-op that returns ok without double-incrementing the
   * denormalized counters. The Follow row, both counter bumps, and the notification event all commit in
   * one transaction so counts can never drift from the edge set.
   */
  async follow(followerId: string, followingId: string): Promise<{ ok: true }> {
    if (followerId === followingId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.follow.create({ data: { followerId, followingId } });
        await tx.user.update({ where: { id: followingId }, data: { followersCount: { increment: 1 } } });
        await tx.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } });
        await this.outbox.emit(tx, OutboxTopic.NotificationCreated, {
          type: 'follow',
          recipientId: followingId,
          actorId: followerId,
        });
      });
    } catch (e) {
      // Already following (composite PK collision) → idempotent success, no double-count.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  /**
   * Unfollow a user. Idempotent: only decrement the counters when a row was actually deleted, so a
   * double-unfollow can't drive the counts negative.
   */
  async unfollow(followerId: string, followingId: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({ where: { followerId, followingId } });
      if (deleted.count === 0) return;
      await tx.user.update({ where: { id: followingId }, data: { followersCount: { decrement: 1 } } });
      await tx.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } });
    });
    return { ok: true };
  }

  /** Public, keyset-paginated list of the users who follow `userId`. */
  async listFollowers(userId: string, q: PaginationQueryDto): Promise<Page<PublicUserResource>> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await this.read.follow.findMany({
      where: {
        followingId: userId,
        ...(cursor ? this.cursorWhere(cursor.v, cursor.id, 'followerId') : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
      take: q.perPage + 1,
      select: { createdAt: true, follower: { select: PUBLIC_USER_SELECT } },
    });
    return this.projectPage(
      rows.map((r) => ({ createdAt: r.createdAt, user: toPublicUserResource(r.follower) })),
      q.perPage,
    );
  }

  /** Public, keyset-paginated list of the users `userId` follows. */
  async listFollowing(userId: string, q: PaginationQueryDto): Promise<Page<PublicUserResource>> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await this.read.follow.findMany({
      where: {
        followerId: userId,
        ...(cursor ? this.cursorWhere(cursor.v, cursor.id, 'followingId') : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { followingId: 'desc' }],
      take: q.perPage + 1,
      select: { createdAt: true, following: { select: PUBLIC_USER_SELECT } },
    });
    return this.projectPage(
      rows.map((r) => ({ createdAt: r.createdAt, user: toPublicUserResource(r.following) })),
      q.perPage,
    );
  }

  /**
   * Keyset seek on (createdAt desc, <edgeKey> desc). `edgeKey` is the PK component on the side we order
   * by (followerId for followers, followingId for following) — a scalar so the seek stays index-friendly.
   */
  private cursorWhere(
    createdAt: string,
    id: string,
    edgeKey: 'followerId' | 'followingId',
  ): Prisma.FollowWhereInput {
    const at = new Date(createdAt);
    const tie: Prisma.FollowWhereInput =
      edgeKey === 'followerId'
        ? { createdAt: at, followerId: { lt: id } }
        : { createdAt: at, followingId: { lt: id } };
    return { OR: [{ createdAt: { lt: at } }, tie] };
  }

  private projectPage(
    rows: { createdAt: Date; user: PublicUserResource }[],
    perPage: number,
  ): Page<PublicUserResource> {
    const page = buildPage(rows, perPage, (row) => ({ v: row.createdAt.toISOString(), id: row.user.id }));
    return { items: page.items.map((row) => row.user), nextCursor: page.nextCursor };
  }
}
