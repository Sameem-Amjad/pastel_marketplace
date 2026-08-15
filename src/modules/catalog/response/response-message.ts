/** Every user-visible string the Catalog (listings + search) module can put on the wire. */
export const CatalogResponseMessage = {
  success: {
    LISTING_CREATED: 'Listing created successfully.',
    LISTING_UPDATED: 'Listing updated successfully.',
    LISTING_DELETED: 'Listing deleted successfully.',
    LISTING_FETCHED: 'Listing fetched successfully.',
    LISTINGS_FETCHED: 'Listings fetched successfully.',
    LISTING_PUBLISHED: 'Listing published successfully.',
    LISTING_CLOSED: 'Listing closed successfully.',
    LISTING_REOPENED: 'Listing reopened successfully.',
    STOCK_UPDATED: 'Stock updated successfully.',
    SEARCH_COMPLETED: 'Listings fetched successfully.',
    SUGGESTIONS_FETCHED: 'Suggestions fetched successfully.',
  },

  fail: {
    LISTING_NOT_FOUND: 'Listing not found.',
    NOT_LISTING_OWNER: 'You can only manage your own listings.',
    LISTING_NOT_PUBLISHED: 'This listing is not published.',
    INVALID_STATE_TRANSITION: 'This listing cannot move to that state.',
    STOCK_VERSION_CONFLICT: 'This listing changed while you were editing it. Reload and try again.',
    INSUFFICIENT_STOCK: 'Not enough stock available for this listing.',
    RELEVANCE_REQUIRES_KEYWORDS: 'Sorting by relevance requires a keywords query.',
    INVALID_CURSOR: 'The pagination cursor is invalid. Start again from the first page.',
  },
} as const;
