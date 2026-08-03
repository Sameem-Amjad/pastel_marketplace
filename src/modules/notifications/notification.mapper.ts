import { Notification } from '@prisma/client';

/**
 * Public projection of a Notification. Notifications are recipient-owned and safe to return mostly
 * as-is; we drop purely-internal scheduling fields (scheduledKey, sendAt) since the client never needs
 * them — scheduled rows are already filtered to "due" before they reach the wire.
 */
export interface NotificationResource {
  id: string;
  type: string;
  recipientMode: string | null;
  actorId: string | null;
  actorName: string | null;
  actorImage: string | null;
  listingId: string | null;
  listingTitle: string | null;
  orderId: string | null;
  showId: string | null;
  storyId: string | null;
  messagePreview: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
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
