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
  @IsOptional()
  @IsObject()
  priorities?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  enabled?: Record<string, unknown>;
}

/** Body for POST /push/token — register or refresh this device's FCM token. */
export class RegisterPushTokenDto {
  @IsString()
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bundleVersion?: string;
}

/** Body for DELETE /push/token — revoke this device's FCM token. */
export class RevokePushTokenDto {
  @IsString()
  @MaxLength(4096)
  token!: string;
}
