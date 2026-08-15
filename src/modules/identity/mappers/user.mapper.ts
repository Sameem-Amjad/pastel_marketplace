import { ApiProperty } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AuthService } from '../services/auth.service';

/**
 * Public-safe user projection. NEVER leak passwordHash / privateData / protectedData to clients.
 * Centralized here so every controller returns the same shape (DRY).
 *
 * Declared as a class purely so `@nestjs/swagger` can introspect it — no instance is ever created;
 * `toUserResource` returns a plain object literal that structurally satisfies the type.
 */
export class UserResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'john@example.com', description: 'Unique email address of the user.' })
  email!: string;

  @ApiProperty({ example: true, description: 'Whether the email address has been confirmed.' })
  emailVerified!: boolean;

  @ApiProperty({
    example: true,
    description:
      'Verified for gating purposes — true when `emailVerified` is set OR the account predates the verification requirement.',
  })
  effectivelyVerified!: boolean;

  @ApiProperty({ example: 'individual', description: 'Account type (individual, business, ...).' })
  userType!: string;

  @ApiProperty({
    example: 'active',
    description: 'One of `active`, `restricted`, `banned`, `deleted`.',
  })
  accountStatus!: string;

  @ApiProperty({ example: 'John', nullable: true })
  firstName!: string | null;

  @ApiProperty({ example: 'Doe', nullable: true })
  lastName!: string | null;

  @ApiProperty({ example: 'John Doe', nullable: true, description: 'Name shown across the app.' })
  displayName!: string | null;

  @ApiProperty({ example: 'Collector of mid-century ceramics.', nullable: true })
  bio!: string | null;

  @ApiProperty({ example: 'johndoe', nullable: true, description: 'Unique @handle.' })
  handle!: string | null;

  @ApiProperty({ example: 'Doe Antiques', nullable: true })
  businessName!: string | null;

  @ApiProperty({ example: 'We restore and resell mid-century furniture.', nullable: true })
  aboutShop!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Id of the profile image asset.' })
  profileImageId!: string | null;

  @ApiProperty({ example: false, description: 'Editorially awarded top-seller badge.' })
  isTopSeller!: boolean;

  @ApiProperty({ example: 128 })
  followersCount!: number;

  @ApiProperty({ example: 64 })
  followingCount!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Client-owned public extended data. Never contains sensitive fields.',
  })
  publicData!: unknown;

  @ApiProperty({ format: 'date-time', example: '2026-08-14T10:00:00.000Z' })
  createdAt!: Date;
}

export function toUserResource(user: User): UserResource {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    effectivelyVerified: AuthService.isEffectivelyVerified(user),
    userType: user.userType,
    accountStatus: user.accountStatus,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    bio: user.bio,
    handle: user.handle,
    businessName: user.businessName,
    aboutShop: user.aboutShop,
    profileImageId: user.profileImageId,
    isTopSeller: user.isTopSeller,
    followersCount: user.followersCount,
    followingCount: user.followingCount,
    publicData: user.publicData,
    createdAt: user.createdAt,
  };
}
