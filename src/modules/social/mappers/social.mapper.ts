import { ApiProperty } from '@nestjs/swagger';
import { Favorite, Highlight, Story } from '@prisma/client';

/**
 * Lightweight, public-safe projections for the Social module.
 *
 * Nothing sensitive (email, passwordHash, privateData/protectedData/metadata) ever crosses these
 * boundaries — list endpoints select only the fields below, and these mappers are the single place
 * shaping outbound social payloads.
 *
 * The resources are classes so Swagger can introspect them; the mappers still return plain object
 * literals that structurally satisfy the types.
 */

export class PublicUserResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'John Doe', nullable: true })
  displayName!: string | null;

  @ApiProperty({ example: 'johndoe', nullable: true, description: 'Unique @handle.' })
  handle!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Id of the profile image asset.' })
  profileImageId!: string | null;
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

export class StoryResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Author of the story.' })
  userId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Listing this story is attached to.',
  })
  listingId!: string | null;

  @ApiProperty({ example: 'standard', description: 'Story kind (standard, highlight-only, ...).' })
  storyType!: string;

  @ApiProperty({ example: 'image', enum: ['image', 'video'] })
  mediaType!: string;

  @ApiProperty({ example: 'https://cdn.mypastel.com/stories/abc.jpg' })
  mediaUrl!: string;

  @ApiProperty({ example: 'https://cdn.mypastel.com/stories/abc-thumb.jpg', nullable: true })
  thumbnailUrl!: string | null;

  @ApiProperty({ example: 'Just restored this piece!', nullable: true })
  description!: string | null;

  @ApiProperty({ example: 12 })
  likeCount!: number;

  @ApiProperty({ example: true, description: 'Surface this story on the linked listing page.' })
  showOnProductPage!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'When the story drops out of the feed. Null for stories that never expire.',
  })
  expiresAt!: Date | null;
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

export class FavoriteResource {
  @ApiProperty({ format: 'uuid', description: 'Owner of the favourite.' })
  userId!: string;

  @ApiProperty({ format: 'uuid', description: 'The favourited listing.' })
  listingId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;
}

export function toFavoriteResource(f: Favorite): FavoriteResource {
  return {
    userId: f.userId,
    listingId: f.listingId,
    createdAt: f.createdAt,
  };
}

export class HighlightResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Owner of the highlight.' })
  userId!: string;

  @ApiProperty({ example: 'Restorations' })
  name!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Story used as the cover image.' })
  coverStoryId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;
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
