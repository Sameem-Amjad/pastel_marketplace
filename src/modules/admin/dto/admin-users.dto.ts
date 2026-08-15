import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** ?status filter for the user list (matches AccountStatus: active|restricted|banned|deleted). */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['active', 'restricted', 'banned', 'deleted'],
    example: 'restricted',
    description: 'Filter by account status. Omit to list every status.',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

/** Body for POST /admin/users/{id}/restrict. */
export class RestrictUserDto {
  @ApiProperty({
    maxLength: 2000,
    example: 'Repeated counterfeit listings after warning.',
    description:
      'Why the account is being restricted. Recorded in the audit log and the appeal file.',
  })
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

/** Body for POST /admin/users/{id}/unrestrict. */
export class UnrestrictUserDto {
  @ApiPropertyOptional({
    maxLength: 2000,
    example: 'Appeal upheld; listings removed.',
    description: 'Why the restriction is being lifted. Defaults to "unrestricted" when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

/** Body for POST /admin/users/{id}/ban. */
export class BanUserDto {
  @ApiProperty({
    maxLength: 2000,
    example: 'Fraudulent payment activity confirmed.',
    description: 'Why the account is being banned. Recorded in the audit log.',
  })
  @IsString()
  @MaxLength(2000)
  reason!: string;
}
