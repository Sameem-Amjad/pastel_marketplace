import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Highlight, HighlightStory } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../../common/prisma/read-prisma.service';
import { AddHighlightStoryDto, CreateHighlightDto } from '../dto/highlight.dto';
import { SocialResponseMessage } from '../response/response-message';

@Injectable()
export class HighlightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
  ) {}

  async create(userId: string, dto: CreateHighlightDto): Promise<Highlight> {
    return this.prisma.highlight.create({
      data: {
        userId,
        name: dto.name,
        coverStoryId: dto.coverStoryId ?? null,
      },
    });
  }

  /** Public list of a user's highlights, newest first. */
  async listForUser(userId: string): Promise<Highlight[]> {
    return this.read.highlight.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** Add a story to a highlight. Owner only — the highlight must belong to the caller. */
  async addStory(
    highlightId: string,
    userId: string,
    dto: AddHighlightStoryDto,
  ): Promise<HighlightStory> {
    await this.assertOwner(highlightId, userId);
    return this.prisma.highlightStory.create({
      data: {
        highlightId,
        storyId: dto.storyId,
        position: dto.position ?? 0,
      },
    });
  }

  private async assertOwner(highlightId: string, userId: string): Promise<void> {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id: highlightId },
      select: { userId: true },
    });
    if (!highlight) throw new NotFoundException(SocialResponseMessage.fail.HIGHLIGHT_NOT_FOUND);
    if (highlight.userId !== userId)
      throw new ForbiddenException(SocialResponseMessage.fail.NOT_HIGHLIGHT_OWNER);
  }
}
