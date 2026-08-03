import { User } from '@prisma/client';
import { AuthService } from './auth.service';

/**
 * Public-safe user projection. NEVER leak passwordHash / privateData / protectedData to clients.
 * Centralized here so every controller returns the same shape (DRY).
 */
export interface UserResource {
  id: string;
  email: string;
  emailVerified: boolean;
  effectivelyVerified: boolean;
  userType: string;
  accountStatus: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
  businessName: string | null;
  aboutShop: string | null;
  profileImageId: string | null;
  isTopSeller: boolean;
  followersCount: number;
  followingCount: number;
  publicData: unknown;
  createdAt: Date;
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
