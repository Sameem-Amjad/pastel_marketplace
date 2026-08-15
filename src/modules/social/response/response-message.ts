/** Every user-visible string the Social (follows, stories, highlights, favourites) module can emit. */
export const SocialResponseMessage = {
  success: {
    USER_FOLLOWED: 'User followed successfully.',
    USER_UNFOLLOWED: 'User unfollowed successfully.',
    FOLLOWERS_FETCHED: 'Followers fetched successfully.',
    FOLLOWING_FETCHED: 'Following list fetched successfully.',

    STORY_CREATED: 'Story created successfully.',
    STORY_LIKED: 'Story liked successfully.',
    STORY_UNLIKED: 'Story unliked successfully.',
    STORIES_FETCHED: 'Stories fetched successfully.',

    HIGHLIGHT_CREATED: 'Highlight created successfully.',
    HIGHLIGHT_STORY_ADDED: 'Story added to highlight successfully.',
    HIGHLIGHTS_FETCHED: 'Highlights fetched successfully.',

    FAVORITE_ADDED: 'Listing added to favourites successfully.',
    FAVORITE_REMOVED: 'Listing removed from favourites successfully.',
    FAVORITES_FETCHED: 'Favourites fetched successfully.',
  },

  fail: {
    USER_NOT_FOUND: 'User not found.',
    CANNOT_FOLLOW_SELF: 'You cannot follow yourself.',
    ALREADY_FOLLOWING: 'You already follow this user.',
    STORY_NOT_FOUND: 'Story not found.',
    STORY_EXPIRED: 'This story is no longer available.',
    NOT_STORY_OWNER: 'You can only manage your own stories.',
    HIGHLIGHT_NOT_FOUND: 'Highlight not found.',
    NOT_HIGHLIGHT_OWNER: 'You can only manage your own highlights.',
    LISTING_NOT_FOUND: 'Listing not found.',
    ALREADY_FAVORITED: 'This listing is already in your favourites.',
  },
} as const;
