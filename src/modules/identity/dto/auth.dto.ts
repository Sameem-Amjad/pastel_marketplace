import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for POST /auth/signup — email/password registration. */
export class SignupDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Unique email address. Normalised to lowercase; a duplicate returns 409.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 8,
    maxLength: 200,
    description: 'Plaintext password, 8–200 characters. Hashed with argon2 and never stored raw.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    maxLength: 100,
    description: 'Name shown across the app. Can be set later via PATCH /me.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;
}

/** Body for POST /auth/login. */
export class LoginDto {
  @ApiProperty({ example: 'john@example.com', description: 'Registered email address.' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    maxLength: 200,
    description: 'Account password. A wrong password and an unknown email return the same 401.',
  })
  @IsString()
  @MaxLength(200)
  password!: string;
}

/** Body for POST /auth/refresh and POST /auth/logout. */
export class RefreshDto {
  @ApiPropertyOptional({
    example: 'v7.9f2c1a...',
    description:
      'Refresh token. Required for React Native (no shared cookie jar); web clients omit it and the httpOnly `pa_rt` cookie is used instead.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string; // native passes it in body; web reads it from cookie
}

/** Body for PATCH /me — every field is optional; omitted fields are left untouched. */
export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'John', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    maxLength: 100,
    description: 'Name shown across the app.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    example: 'Collector of mid-century ceramics.',
    maxLength: 2000,
    description: 'Free-text profile bio.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({
    example: 'We restore and resell mid-century furniture.',
    maxLength: 2000,
    description: 'Seller-facing shop description shown on the storefront.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  aboutShop?: string;
}
