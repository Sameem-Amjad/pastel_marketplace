import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Body for POST /notifications/mark-read. Omit `ids` to mark ALL of my notifications read. */
export class MarkReadDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 500,
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    description:
      'Notification ids to mark read, max 500. **Omit this field entirely to mark every notification read.**',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids?: string[];
}

/**
 * Body for PUT /notifications/preferences. Both maps are free-form JSON owned by the client:
 *   priorities: { [type]: 'low' | 'default' | 'high' }
 *   enabled:    { buyer|seller: { [type]: boolean } }
 * Either may be omitted; an omitted key leaves the stored value untouched.
 */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { 'order.purchased': 'high', 'social.follow': 'low' },
    description:
      'Per-type delivery priority: `{ [type]: "low" | "default" | "high" }`. Omit to leave unchanged.',
  })
  @IsOptional()
  @IsObject()
  priorities?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { buyer: { 'order.shipped': true }, seller: { 'order.purchased': true } },
    description:
      'Per-mode opt-in: `{ buyer|seller: { [type]: boolean } }`. Omit to leave unchanged.',
  })
  @IsOptional()
  @IsObject()
  enabled?: Record<string, unknown>;
}

/** Body for POST /push/token — register or refresh this device's FCM token. */
export class RegisterPushTokenDto {
  @ApiProperty({
    maxLength: 4096,
    example: 'fcm-token-abc123...',
    description: 'FCM registration token from the Expo/Firebase SDK on this device.',
  })
  @IsString()
  @MaxLength(4096)
  token!: string;

  @ApiPropertyOptional({
    enum: ['ios', 'android', 'web'],
    example: 'ios',
    description: 'Device platform, used to pick the correct push payload shape.',
  })
  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    example: '1.4.0',
    description: 'App version, for debugging delivery issues per release.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    example: '104',
    description: 'Native build/bundle number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bundleVersion?: string;
}

/** Body for DELETE /push/token — revoke this device's FCM token. */
export class RevokePushTokenDto {
  @ApiProperty({
    maxLength: 4096,
    example: 'fcm-token-abc123...',
    description: 'The token to revoke — send the same value that was registered.',
  })
  @IsString()
  @MaxLength(4096)
  token!: string;
}
