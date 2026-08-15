import { ApiProperty } from '@nestjs/swagger';
import { Notification } from '@prisma/client';

/**
 * Public projection of a Notification. Notifications are recipient-owned and safe to return mostly
 * as-is; we drop purely-internal scheduling fields (scheduledKey, sendAt) since the client never needs
 * them — scheduled rows are already filtered to "due" before they reach the wire.
 */
export class NotificationResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({
    example: 'order.purchased',
    description: 'Notification type — drives the icon and deep link in the app.',
  })
  type!: string;

  @ApiProperty({
    example: 'buyer',
    nullable: true,
    description: 'Which hat the recipient was wearing: `buyer` or `seller`.',
  })
  recipientMode!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'User who triggered this.' })
  actorId!: string | null;

  @ApiProperty({
    example: 'John Doe',
    nullable: true,
    description: 'Denormalised for fast rendering.',
  })
  actorName!: string | null;

  @ApiProperty({ nullable: true, description: 'Denormalised actor avatar reference.' })
  actorImage!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  listingId!: string | null;

  @ApiProperty({ example: 'Mid-century teak sideboard', nullable: true })
  listingTitle!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  orderId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  showId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  storyId!: string | null;

  @ApiProperty({ example: 'Is this still available?', nullable: true })
  messagePreview!: string | null;

  @ApiProperty({ example: false })
  read!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;
}

export function toNotificationResource(n: Notification): NotificationResource {
  return {
    id: n.id,
    type: n.type,
    recipientMode: n.recipientMode,
    actorId: n.actorId,
    actorName: n.actorName,
    actorImage: n.actorImage,
    listingId: n.listingId,
    listingTitle: n.listingTitle,
    orderId: n.orderId,
    showId: n.showId,
    storyId: n.storyId,
    messagePreview: n.messagePreview,
    read: n.read,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
