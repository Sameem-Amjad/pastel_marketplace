/**
 * Every user-visible string the Identity module can put on the wire.
 *
 * Controllers reference these via @ResponseMessage; services reference the `fail` entries when
 * throwing. Nothing in this module should ever construct a message literal inline — copy changes and
 * translations then have exactly one place to happen.
 */
export const AuthResponseMessage = {
  success: {
    SIGNUP_COMPLETED: 'Account created successfully.',
    LOGIN_COMPLETED: 'Signed in successfully.',
    TOKEN_REFRESHED: 'Session refreshed successfully.',
    LOGOUT_COMPLETED: 'Signed out successfully.',
    AUTH_INFO_FETCHED: 'Authentication info fetched successfully.',
    PROFILE_FETCHED: 'Profile fetched successfully.',
    PROFILE_UPDATED: 'Profile updated successfully.',
  },

  fail: {
    INVALID_CREDENTIALS: 'Invalid email or password.',
    EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
    USER_NOT_FOUND: 'User not found.',
    ACCOUNT_RESTRICTED: 'This account is restricted and cannot perform this action.',
    ACCOUNT_BANNED: 'This account has been banned.',
    REFRESH_TOKEN_MISSING: 'No refresh token was provided.',
    REFRESH_TOKEN_INVALID: 'This session has expired. Please sign in again.',
    EMAIL_NOT_VERIFIED: 'Please verify your email address to continue.',
  },
} as const;
