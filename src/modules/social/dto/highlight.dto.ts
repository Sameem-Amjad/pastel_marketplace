import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateHighlightDto {
  @IsString() @MaxLength(120) name!: string;

  /** Optional story used as the highlight's cover. */
  @IsOptional() @IsUUID() coverStoryId?: string;
}

export class AddHighlightStoryDto {
  @IsUUID() storyId!: string;

  /** Ordering within the highlight (lower comes first). Defaults to 0. */
  @IsOptional() @IsInt() @Min(0) position?: number;
}
