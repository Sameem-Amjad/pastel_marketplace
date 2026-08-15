/**
 * Cross-cutting response messages — the ones produced by the framework itself (validation, auth,
 * rate limiting, unexpected failures) rather than by a specific domain.
 *
 * Domain messages live next to their module in `modules/<module>/response/response-message.ts`.
 * Keeping every user-visible string in one of these two places means copy changes never require
 * hunting through controllers, and the Expo client can be tested against a known vocabulary.
 */
export const CommonResponseMessage = {
  success: {
    /** Interceptor fallback when a handler declares no @ResponseMessage. */
    REQUEST_SUCCEEDED: 'Request completed successfully.',
    RESOURCE_FETCHED: 'Resource fetched successfully.',
    RESOURCE_CREATED: 'Resource created successfully.',
    RESOURCE_UPDATED: 'Resource updated successfully.',
    RESOURCE_DELETED: 'Resource deleted successfully.',
    SERVICE_HEALTHY: 'Service is healthy.',
  },

  fail: {
    VALIDATION_FAILED: 'Validation failed.',
    BAD_REQUEST: 'The request could not be processed.',
    UNAUTHORIZED: 'Authentication is required to access this resource.',
    FORBIDDEN: 'You do not have permission to perform this action.',
    NOT_FOUND: 'The requested resource was not found.',
    CONFLICT: 'The request conflicts with the current state of the resource.',
    UNPROCESSABLE_ENTITY: 'The request references data that does not exist.',
    TOO_MANY_REQUESTS: 'Too many requests. Please slow down and try again shortly.',
    INTERNAL_SERVER_ERROR: 'Something went wrong. Please try again later.',
    SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again later.',
  },
} as const;
