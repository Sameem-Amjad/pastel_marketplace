import { Injectable } from '@nestjs/common';
import { Prisma, Story } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../common/prisma/read-prisma.service';
import { CreateStoryDto } from './dto/story.dto';

const STORY_TTL_MS = 24 * 60 * 60 * 1000; // public stories live 24h

@Injectable()
export class StoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
  ) {}

  /**
   * Create a public story. Public stories auto-expire 24h after creation (expiresAt = now + 24h); the
   * Story.likeCount denormalized counter starts at the schema default (0).
   */
  async create(userId: string, dto: CreateStoryDto): Promise<Story> {
    return this.prisma.story.create({
      data: {
        userId,
        listingId: dto.listingId ?? null,
        storyType: 'public',
        mediaType: dto.mediaType,
        mediaUrl: dto.mediaUrl,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        description: dto.description ?? null,
        showOnProductPage: dto.showOnProductPage ?? false,
        expiresAt: new Date(Date.now() + STORY_TTL_MS),
      },
    });
  }

  /** A user's still-visible stories (never-expiring OR not-yet-expired), newest first. */
  async listForUser(userId: string): Promise<Story[]> {
    const now = new Date();
    return this.read.story.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Like a story. Idempotent: the StoryLike row and the Story.likeCount bump commit together, and the
   * count only moves when a row is actually inserted, so a double-like can't inflate it.
   */
  async like(storyId: string, userId: string): Promise<{ ok: true }> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.storyLike.create({ data: { storyId, userId } });
        await tx.story.update({ where: { id: storyId }, data: { likeCount: { increment: 1 } } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true }; // already liked → no double count
      }
      throw e;
    }
    return { ok: true };
  }

  /**
   * Unlike a story. Idempotent: only decrement likeCount when a StoryLike row was actually deleted, so
   * unliking what isn't liked can't drive the count negative.
   */
  async unlike(storyId: string, userId: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.storyLike.deleteMany({ where: { storyId, userId } });
      if (deleted.count === 0) return;
      await tx.story.update({ where: { id: storyId }, data: { likeCount: { decrement: 1 } } });
    });
    return { ok: true };
  }
}
