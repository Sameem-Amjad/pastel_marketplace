import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Allowed story media kinds — mirrors the Prisma `MediaType` enum (image | video). */
const MEDIA_TYPES = ['image', 'video'] as const;
export type StoryMediaType = (typeof MEDIA_TYPES)[number];

/** Body for POST /stories. Media must already be uploaded — this endpoint takes URLs, not files. */
export class CreateStoryDto {
  @ApiProperty({
    enum: MEDIA_TYPES,
    example: 'image',
    description: 'Kind of media being posted.',
  })
  @IsIn(MEDIA_TYPES)
  mediaType!: StoryMediaType;

  @ApiProperty({
    example: 'https://cdn.mypastel.com/stories/abc.jpg',
    maxLength: 2048,
    description: 'URL of the already-uploaded media asset.',
  })
  @IsString()
  @MaxLength(2_048)
  mediaUrl!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.mypastel.com/stories/abc-thumb.jpg',
    maxLength: 2048,
    description: 'Poster image. Strongly recommended for videos so the feed can render instantly.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  thumbnailUrl?: string;

  @ApiPropertyOptional({
    example: 'Just restored this piece!',
    maxLength: 2000,
    description: 'Caption shown over the story.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  /** Optional product this story is attached to. */
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Listing this story is about. Enables the "shop this story" tap-through.',
  })
  @IsOptional()
  @IsUUID()
  listingId?: string;

  /** Surface this story on the linked listing's product page. */
  @ApiPropertyOptional({
    example: true,
    description: 'Also show this story on the linked listing page. Requires `listingId`.',
  })
  @IsOptional()
  @IsBoolean()
  showOnProductPage?: boolean;
}
