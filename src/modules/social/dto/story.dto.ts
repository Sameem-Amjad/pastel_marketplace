import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Allowed story media kinds — mirrors the Prisma `MediaType` enum (image | video). */
const MEDIA_TYPES = ['image', 'video'] as const;
export type StoryMediaType = (typeof MEDIA_TYPES)[number];

export class CreateStoryDto {
  @IsIn(MEDIA_TYPES) mediaType!: StoryMediaType;
  @IsString() @MaxLength(2_048) mediaUrl!: string;

  @IsOptional() @IsString() @MaxLength(2_048) thumbnailUrl?: string;
  @IsOptional() @IsString() @MaxLength(2_000) description?: string;

  /** Optional product this story is attached to. */
  @IsOptional() @IsUUID() listingId?: string;

  /** Surface this story on the linked listing's product page. */
  @IsOptional() @IsBoolean() showOnProductPage?: boolean;
}
