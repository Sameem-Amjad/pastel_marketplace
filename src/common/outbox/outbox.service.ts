import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Known outbox topics (doc 01 §5.4). Centralized so producers/consumers can't drift on string keys.
 */
export const OutboxTopic = {
  OrderTransitioned: 'order.transitioned',
  ListingPublished: 'listing.published',
  ListingChanged: 'listing.changed',
  ListingClosed: 'listing.closed',
  NotificationCreated: 'notification.created',
  PayoutReleased: 'payout.released',
} as const;
export type OutboxTopic = (typeof OutboxTopic)[keyof typeof OutboxTopic];

/**
 * Transactional Outbox writer (doc 01 §5.4, doc 05).
 *
 * The whole point: the event row is written in the SAME database transaction as the state change it
 * describes. Either both commit or neither does — there is no window where an order transitioned but the
 * search index / push / tax sync never heard about it. A separate relay worker drains pending rows and
 * fans them out (at-least-once; consumers must be idempotent).
 *
 * Usage — always pass the active transaction client:
 *   await this.prisma.$transaction(async (tx) => {
 *     await tx.order.update({ ... });
 *     await this.outbox.emit(tx, OutboxTopic.OrderTransitioned, { orderId, transition });
 *   });
 */
@Injectable()
export class OutboxService {
  async emit(
    tx: Prisma.TransactionClient,
    topic: OutboxTopic,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.outbox.create({ data: { topic, payload } });
  }
}
