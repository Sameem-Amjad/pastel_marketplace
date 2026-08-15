import { ApiProperty } from '@nestjs/swagger';
import { User } from '@prisma/client';

/**
 * Operator-facing user projection. Operators may see email, but passwordHash / privateData / other
 * sensitive buckets MUST never leave the server — keep this list explicit.
 */
export class AdminUserResource {
  @ApiProperty({ format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'john@example.com' })
  email!: string;

  @ApiProperty({ example: 'individual' })
  userType!: string;

  @ApiProperty({
    example: 'active',
    description: '`active`, `restricted`, `banned`, or `deleted`.',
  })
  accountStatus!: string;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'When the current restriction was applied; null when the account is unrestricted.',
  })
  restrictedAt!: Date | null;
}

/** Minimal columns the list/detail mapper needs (lets callers select() exactly these). */
export type AdminUserProjection = Pick<
  User,
  'id' | 'email' | 'userType' | 'accountStatus' | 'restrictedAt'
>;

export function toAdminUserResource(u: AdminUserProjection): AdminUserResource {
  return {
    id: u.id,
    email: u.email,
    userType: u.userType,
    accountStatus: u.accountStatus,
    restrictedAt: u.restrictedAt,
  };
}
