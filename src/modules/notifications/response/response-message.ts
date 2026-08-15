/** Every user-visible string the Notifications (inbox + push tokens) module can put on the wire. */
export const NotificationResponseMessage = {
  success: {
    NOTIFICATIONS_FETCHED: 'Notifications fetched successfully.',
    UNREAD_COUNT_FETCHED: 'Unread count fetched successfully.',
    NOTIFICATIONS_MARKED_READ: 'Notifications marked as read successfully.',
    PREFERENCES_FETCHED: 'Notification preferences fetched successfully.',
    PREFERENCES_UPDATED: 'Notification preferences updated successfully.',
    PUSH_TOKEN_REGISTERED: 'Push token registered successfully.',
    PUSH_TOKEN_REVOKED: 'Push token revoked successfully.',
  },

  fail: {
    NOTIFICATION_NOT_FOUND: 'Notification not found.',
    INVALID_PREFERENCES: 'Notification preferences payload is invalid.',
    PUSH_TOKEN_INVALID: 'The supplied push token is not valid.',
  },
} as const;
