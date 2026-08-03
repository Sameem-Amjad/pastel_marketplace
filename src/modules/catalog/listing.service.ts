import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Listing, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../common/prisma/read-prisma.service';
import { OutboxService, OutboxTopic } from '../../common/outbox/outbox.service';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto';

@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(authorId: string, dto: CreateListingDto): Promise<Listing> {
    return this.prisma.listing.create({
      data: {
        authorId,
        title: dto.title,
        description: dto.description,
        priceAmount: dto.priceAmount === undefined ? null : BigInt(dto.priceAmount),
        priceCurrency: dto.priceCurrency?.toUpperCase(),
        categoryL1: dto.categoryL1,
        categoryL2: dto.categoryL2,
        categoryL3: dto.categoryL3,
        condition: dto.condition,
        period: dto.period,
        origin: dto.origin,
        materials: dto.materials ?? [],
        stockQuantity: dto.stockQuantity ?? 0,
        state: 'draft',
      },
    });
  }

  /** Public detail read — replica. Hides soft-deleted listings. */
  async getPublic(id: string): Promise<Listing> {
    const listing = await this.read.listing.findFirst({ where: { id, deletedAt: null } });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  async update(id: string, authorId: string, dto: UpdateListingDto): Promise<Listing> {
    await this.assertOwner(id, authorId);
    return this.prisma.listing.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        priceAmount: dto.priceAmount === undefined ? undefined : BigInt(dto.priceAmount),
        priceCurrency: dto.priceCurrency?.toUpperCase(),
        categoryL1: dto.categoryL1,
        categoryL2: dto.categoryL2,
        categoryL3: dto.categoryL3,
        condition: dto.condition,
        period: dto.period,
        origin: dto.origin,
        materials: dto.materials,
      },
    });
  }

  async publish(id: string, authorId: string): Promise<Listing> {
    await this.assertOwner(id, authorId);
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.update({
        where: { id },
        data: { state: 'published', publishedAt: new Date() },
      });
      // listing_search is maintained by DB trigger; the outbox event is for OTHER consumers
      // (Phase-B search engine, notifications, sitemap) — at-least-once, idempotent.
      await this.outbox.emit(tx, OutboxTopic.ListingPublished, { listingId: id });
      return listing;
    });
  }

  async close(id: string, authorId: string): Promise<Listing> {
    await this.assertOwner(id, authorId);
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.update({ where: { id }, data: { state: 'closed' } });
      await this.outbox.emit(tx, OutboxTopic.ListingClosed, { listingId: id });
      return listing;
    });
  }

  async reopen(id: string, authorId: string): Promise<Listing> {
    await this.assertOwner(id, authorId);
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.update({
        where: { id },
        data: { state: 'published', publishedAt: new Date() },
      });
      await this.outbox.emit(tx, OutboxTopic.ListingPublished, { listingId: id });
      return listing;
    });
  }

  async softDelete(id: string, authorId: string): Promise<void> {
    await this.assertOwner(id, authorId);
    // Setting deletedAt + closing evicts it from listing_search via trigger.
    await this.prisma.listing.update({
      where: { id },
      data: { deletedAt: new Date(), state: 'closed' },
    });
  }

  /**
   * Compare-and-set stock decrement (doc 03 CAT-1, doc 02 `stockVersion`).
   *
   * Replaces Sharetribe's compareAndSet. The UPDATE only matches if stockVersion is unchanged since the
   * client read it — so two concurrent buyers racing for the last unit can't both succeed: the loser's
   * version no longer matches and gets a 409. Auto-closes the listing when stock hits 0.
   */
  async setStock(
    id: string,
    authorId: string,
    newQuantity: number,
    expectedVersion?: number,
  ): Promise<Listing> {
    const where: Prisma.ListingWhereInput = { id, authorId, deletedAt: null };
    if (expectedVersion !== undefined) where.stockVersion = expectedVersion;

    const result = await this.prisma.listing.updateMany({
      where,
      data: {
        stockQuantity: newQuantity,
        stockVersion: { increment: 1 },
        // auto-close when the last unit is gone (CAT-4)
        ...(newQuantity <= 0 ? { state: 'closed' as const } : {}),
      },
    });

    if (result.count === 0) {
      // Either the version moved under us (concurrent update) or the listing isn't ours.
      const exists = await this.prisma.listing.findFirst({ where: { id, authorId }, select: { id: true } });
      if (!exists) throw new ForbiddenException('Not your listing');
      throw new ConflictException('Stock version conflict — reload and retry');
    }
    return this.prisma.listing.findUniqueOrThrow({ where: { id } });
  }

  async listOwn(authorId: string, limit = 50): Promise<Listing[]> {
    return this.read.listing.findMany({
      where: { authorId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  private async assertOwner(id: string, authorId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({ where: { id }, select: { authorId: true, deletedAt: true } });
    if (!listing || listing.deletedAt) throw new NotFoundException('Listing not found');
    if (listing.authorId !== authorId) throw new ForbiddenException('Not your listing');
  }
}
