import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../../common/prisma/read-prisma.service';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { buildPage, decodeCursor, Page } from '../../../common/pagination/cursor.util';
import { FavoriteResource, toFavoriteResource } from '../mappers/social.mapper';

@Injectable()
export class FavoriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
  ) {}

  /** Add a listing to the user's wishlist. Idempotent — re-adding is a no-op. */
  async add(userId: string, listingId: string): Promise<{ ok: true }> {
    try {
      await this.prisma.favorite.create({ data: { userId, listingId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  /** Remove a listing from the wishlist. Idempotent — removing what isn't there is a no-op. */
  async remove(userId: string, listingId: string): Promise<{ ok: true }> {
    await this.prisma.favorite.deleteMany({ where: { userId, listingId } });
    return { ok: true };
  }

  /** The caller's wishlist, keyset-paginated newest-first. */
  async listMine(userId: string, q: PaginationQueryDto): Promise<Page<FavoriteResource>> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const where: Prisma.FavoriteWhereInput = { userId };
    if (cursor) {
      const at = new Date(cursor.v);
      where.OR = [{ createdAt: { lt: at } }, { createdAt: at, listingId: { lt: cursor.id } }];
    }
    const rows = await this.read.favorite.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { listingId: 'desc' }],
      take: q.perPage + 1,
    });
    const page = buildPage(rows, q.perPage, (row) => ({
      v: row.createdAt.toISOString(),
      id: row.listingId,
    }));
    return { items: page.items.map(toFavoriteResource), nextCursor: page.nextCursor };
  }
}
