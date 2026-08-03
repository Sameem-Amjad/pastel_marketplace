import { User } from '@prisma/client';

/**
 * Operator-facing user projection. Operators may see email, but passwordHash / privateData / other
 * sensitive buckets MUST never leave the server — keep this list explicit.
 */
export interface AdminUserResource {
  id: string;
  email: string;
  userType: string;
  accountStatus: string;
  restrictedAt: Date | null;
}

/** Minimal columns the list/detail mapper needs (lets callers select() exactly these). */
export type AdminUserProjection = Pick<User, 'id' | 'email' | 'userType' | 'accountStatus' | 'restrictedAt'>;

export function toAdminUserResource(u: AdminUserProjection): AdminUserResource {
  return {
    id: u.id,
    email: u.email,
    userType: u.userType,
    accountStatus: u.accountStatus,
    restrictedAt: u.restrictedAt,
  };
}
