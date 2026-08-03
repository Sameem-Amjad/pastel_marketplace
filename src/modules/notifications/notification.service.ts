import { Injectable, Logger } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../common/prisma/read-prisma.service';
import { buildPage, Cursor, decodeCursor, Page } from '../../common/pagination/cursor.util';

/**
 * Fields a caller may set when creating a notification. `recipientId` and `type` are required; every
 * other context field is optional and mirrors the Notification model. We deliberately omit server-owned
 * columns (id, read, readAt, createdAt) — those are defaulted by Prisma/the DB.
 */
export interface CreateNotificationInput {
  recipientId: string;
  type: string;
  recipientMode?: 'buyer' | 'seller';
  actorId?: string;
  actorName?: string;
  actorImage?: string;
  listingId?: string;
  listingTitle?: string;
  /** Presence of `orderId` marks this an order-transition notification → P2002-deduped. */
  orderId?: string;
  showId?: string;
  storyId?: string;
  messagePreview?: string;
}

/**
 * Input for scheduled (future-visible) notifications. `scheduledKey` must be deterministic so that
 * re-scheduling the same event is idempotent (upsert), and `sendAt` is when it becomes visible.
 */
export interface CreateScheduledNotificationInput extends CreateNotificationInput {
  scheduledKey: string;
  sendAt: Date;
}

/**
 * Central notification service. This is the reusable seam other modules (orders, social, live shows)
 * inject to enqueue in-app notifications. The HTTP surface (controllers) is a thin layer over the read
 * queries and the user-facing preference/token mutations.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
  ) {}

  /**
   * Insert a notification. For order-transition notifications (those carrying `orderId`) a PARTIAL
   * UNIQUE index on (recipientId, orderId, type) WHERE orderId IS NOT NULL makes a duplicate a P2002 —
   * we swallow it and return null so callers can treat re-delivery as an idempotent no-op.
   *
   * @returns the created Notification, or null when deduped.
   */
  async create(input: CreateNotificationInput): Promise<Notification | null> {
    const data = this.toCreateData(input);
    if (input.orderId === undefined) {
      return this.prisma.notification.create({ data });
    }
    try {
      return await this.prisma.notification.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.debug(
          `Deduped order notification recipient=${input.recipientId} order=${input.orderId} type=${input.type}`,
        );
        return null;
      }
      throw e;
    }
  }

  /**
   * Schedule (or re-schedule) a future-visible notification keyed by a deterministic `scheduledKey`
   * (e.g. `upcoming_live_{showId}_{recipientId}`). Upsert keeps re-scheduling idempotent: the same key
   * updates the existing row's sendAt/context instead of creating a duplicate.
   */
  async createScheduled(input: CreateScheduledNotificationInput): Promise<Notification> {
    const base = this.toCreateData(input);
    return this.prisma.notification.upsert({
      where: { scheduledKey: input.scheduledKey },
      create: { ...base, scheduledKey: input.scheduledKey, sendAt: input.sendAt },
      update: {
        sendAt: input.sendAt,
        type: input.type,
        recipientMode: input.recipientMode ?? null,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        actorImage: input.actorImage ?? null,
        listingId: input.listingId ?? null,
        listingTitle: input.listingTitle ?? null,
        showId: input.showId ?? null,
        storyId: input.storyId ?? null,
        messagePreview: input.messagePreview ?? null,
      },
    });
  }

  /** Cancel a single scheduled notification by its deterministic key (the "schedule then cancel" pattern). */
  async clearScheduled(scheduledKey: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { scheduledKey } });
  }

  /**
   * Cancel all scheduled/live-reminder notifications for a show of the given types — invoked when a show
   * starts or ends so pending "upcoming live" reminders don't fire after they're moot.
   */
  async clearByShow(showId: string, types: string[]): Promise<void> {
    await this.prisma.notification.deleteMany({
      where: { showId, type: { in: types } },
    });
  }

  // ── user-facing reads/mutations (backing the controllers) ───────────────────

  /**
   * My notifications, newest-first, keyset-paginated on (createdAt, id). Future-scheduled rows
   * (sendAt > now) are hidden until due. Served from the read replica.
   */
  async listForUser(
    recipientId: string,
    perPage: number,
    cursor?: string,
  ): Promise<Page<Notification>> {
    // Both the visibility rule and the keyset seek are OR-shaped, so AND them together rather than
    // assigning `where.OR` twice (the second would clobber the first).
    const and: Prisma.NotificationWhereInput[] = [this.visibleFilter()];

    const decoded = cursor ? decodeCursor(cursor) : null;
    if (decoded) {
      // Keyset seek for DESC (createdAt, id): the next page is everything strictly "before" the last row.
      const createdAt = new Date(decoded.v);
      and.push({
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: decoded.id } }],
      });
    }

    const where: Prisma.NotificationWhereInput = { recipientId, AND: and };

    const rows = await this.read.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: perPage + 1,
    });

    return buildPage(rows, perPage, this.toCursor);
  }

  /** Count of my unread, currently-visible notifications. Served from the read replica. */
  async unreadCount(recipientId: string): Promise<number> {
    return this.read.notification.count({
      where: { recipientId, read: false, ...this.visibleFilter() },
    });
  }

  /**
   * Mark my notifications read. With `ids`, only those rows (still scoped to me); without, all of mine.
   * @returns number of rows updated.
   */
  async markRead(recipientId: string, ids?: string[]): Promise<number> {
    const where: Prisma.NotificationWhereInput = { recipientId, read: false };
    if (ids !== undefined) {
      if (ids.length === 0) return 0;
      where.id = { in: ids };
    }
    const result = await this.prisma.notification.updateMany({
      where,
      data: { read: true, readAt: new Date() },
    });
    return result.count;
  }

  /** Read my preferences, returning defaults (empty maps) when none have been saved yet. */
  async getPreferences(
    userId: string,
  ): Promise<{ priorities: Prisma.JsonValue; enabled: Prisma.JsonValue }> {
    const pref = await this.read.notificationPreference.findUnique({ where: { userId } });
    return {
      priorities: pref?.priorities ?? {},
      enabled: pref?.enabled ?? {},
    };
  }

  /** Upsert my preferences. Omitted maps leave the stored value untouched. */
  async updatePreferences(
    userId: string,
    priorities?: Record<string, unknown>,
    enabled?: Record<string, unknown>,
  ): Promise<{ priorities: Prisma.JsonValue; enabled: Prisma.JsonValue }> {
    const create: Prisma.NotificationPreferenceCreateInput = {
      userId,
      priorities: (priorities ?? {}) as Prisma.InputJsonValue,
      enabled: (enabled ?? {}) as Prisma.InputJsonValue,
    };
    const update: Prisma.NotificationPreferenceUpdateInput = {};
    if (priorities !== undefined) update.priorities = priorities as Prisma.InputJsonValue;
    if (enabled !== undefined) update.enabled = enabled as Prisma.InputJsonValue;

    const pref = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create,
      update,
    });
    return { priorities: pref.priorities, enabled: pref.enabled };
  }

  /** Register or refresh this device's FCM token. Idempotent on (userId, token); un-revokes on re-register. */
  async registerPushToken(
    userId: string,
    token: string,
    platform?: string,
    appVersion?: string,
    bundleVersion?: string,
  ): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { userId_token: { userId, token } },
      create: {
        userId,
        token,
        platform: platform ?? null,
        appVersion: appVersion ?? null,
        bundleVersion: bundleVersion ?? null,
        revoked: false,
      },
      update: {
        platform: platform ?? null,
        appVersion: appVersion ?? null,
        bundleVersion: bundleVersion ?? null,
        revoked: false,
      },
    });
  }

  /** Revoke this device's FCM token (logout / token rotation). No-op if it isn't registered. */
  async revokePushToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.updateMany({
      where: { userId, token },
      data: { revoked: true },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** WHERE fragment: a row is visible when it's not a future-scheduled one. */
  private visibleFilter(): Prisma.NotificationWhereInput {
    return { OR: [{ sendAt: null }, { sendAt: { lte: new Date() } }] };
  }

  private toCursor(n: Notification): Cursor {
    return { v: n.createdAt.toISOString(), id: n.id };
  }

  /** Map the public input shape onto Prisma create data, normalising undefined → null for set columns. */
  private toCreateData(input: CreateNotificationInput): Prisma.NotificationCreateInput {
    return {
      recipientId: input.recipientId,
      type: input.type,
      recipientMode: input.recipientMode ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      actorImage: input.actorImage ?? null,
      listingId: input.listingId ?? null,
      listingTitle: input.listingTitle ?? null,
      orderId: input.orderId ?? null,
      showId: input.showId ?? null,
      storyId: input.storyId ?? null,
      messagePreview: input.messagePreview ?? null,
    };
  }
}
