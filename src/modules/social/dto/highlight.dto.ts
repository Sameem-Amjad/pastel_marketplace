import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Body for POST /highlights — a named, permanent collection of stories on a profile. */
export class CreateHighlightDto {
  @ApiProperty({
    example: 'Restorations',
    maxLength: 120,
    description: 'Label shown under the highlight bubble on the profile.',
  })
  @IsString()
  @MaxLength(120)
  name!: string;

  /** Optional story used as the highlight's cover. */
  @ApiPropertyOptional({
    format: 'uuid',
    description: "Story whose thumbnail becomes the highlight's cover image.",
  })
  @IsOptional()
  @IsUUID()
  coverStoryId?: string;
}

/** Body for POST /highlights/{id}/stories — pins an existing story into a highlight. */
export class AddHighlightStoryDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The story to add. Adding it here keeps it visible after the story would expire.',
  })
  @IsUUID()
  storyId!: string;

  /** Ordering within the highlight (lower comes first). Defaults to 0. */
  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    default: 0,
    description: 'Sort position within the highlight; lower comes first.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
