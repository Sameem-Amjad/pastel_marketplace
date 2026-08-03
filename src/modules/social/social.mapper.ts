import { Favorite, Highlight, Story } from '@prisma/client';

/**
 * Lightweight, public-safe projections for the Social module.
 *
 * Nothing sensitive (email, passwordHash, privateData/protectedData/metadata) ever crosses these
 * boundaries — list endpoints select only the fields below, and these mappers are the single place
 * shaping outbound social payloads.
 */

export interface PublicUserResource {
  id: string;
  displayName: string | null;
  handle: string | null;
  profileImageId: string | null;
}

/** The minimal set of User columns a public projection is allowed to read. */
export interface PublicUserSelection {
  id: string;
  displayName: string | null;
  handle: string | null;
  profileImageId: string | null;
}

/** Prisma `select` clause guaranteeing only public-safe user columns are fetched. */
export const PUBLIC_USER_SELECT = {
  id: true,
  displayName: true,
  handle: true,
  profileImageId: true,
} as const;

export function toPublicUserResource(u: PublicUserSelection): PublicUserResource {
  return {
    id: u.id,
    displayName: u.displayName,
    handle: u.handle,
    profileImageId: u.profileImageId,
  };
}

export interface StoryResource {
  id: string;
  userId: string;
  listingId: string | null;
  storyType: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  description: string | null;
  likeCount: number;
  showOnProductPage: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export function toStoryResource(s: Story): StoryResource {
  return {
    id: s.id,
    userId: s.userId,
    listingId: s.listingId,
    storyType: s.storyType,
    mediaType: s.mediaType,
    mediaUrl: s.mediaUrl,
    thumbnailUrl: s.thumbnailUrl,
    description: s.description,
    likeCount: s.likeCount,
    showOnProductPage: s.showOnProductPage,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  };
}

export interface FavoriteResource {
  userId: string;
  listingId: string;
  createdAt: Date;
}

export function toFavoriteResource(f: Favorite): FavoriteResource {
  return {
    userId: f.userId,
    listingId: f.listingId,
    createdAt: f.createdAt,
  };
}

export interface HighlightResource {
  id: string;
  userId: string;
  name: string;
  coverStoryId: string | null;
  createdAt: Date;
}

export function toHighlightResource(h: Highlight): HighlightResource {
  return {
    id: h.id,
    userId: h.userId,
    name: h.name,
    coverStoryId: h.coverStoryId,
    createdAt: h.createdAt,
  };
}
