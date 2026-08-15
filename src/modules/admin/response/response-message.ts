/** Every operator-visible string the Admin (users + moderation) module can put on the wire. */
export const AdminResponseMessage = {
  success: {
    USERS_FETCHED: 'Users fetched successfully.',
    USER_FETCHED: 'User fetched successfully.',
    USER_RESTRICTED: 'User restricted successfully.',
    USER_UNRESTRICTED: 'User unrestricted successfully.',
    USER_BANNED: 'User banned successfully.',

    REPORTS_FETCHED: 'Content reports fetched successfully.',
    REPORT_RESOLVED: 'Content report resolved successfully.',

    APPEALS_FETCHED: 'Appeals fetched successfully.',
    APPEAL_REVIEWED: 'Appeal reviewed successfully.',

    WAITLIST_FETCHED: 'Waitlist fetched successfully.',
    WAITLIST_APPROVED: 'Waitlist entry approved successfully.',

    DELETION_REQUESTS_FETCHED: 'Account deletion requests fetched successfully.',
    DELETION_REQUEST_COMPLETED: 'Account deletion request completed successfully.',
  },

  fail: {
    USER_NOT_FOUND: 'User not found.',
    NOT_AN_OPERATOR: 'This action requires operator privileges.',
    REPORT_NOT_FOUND: 'Content report not found.',
    APPEAL_NOT_FOUND: 'Appeal not found.',
    WAITLIST_ENTRY_NOT_FOUND: 'Waitlist entry not found.',
    DELETION_REQUEST_NOT_FOUND: 'Account deletion request not found.',
    ALREADY_RESOLVED: 'This item has already been resolved.',
  },
} as const;
