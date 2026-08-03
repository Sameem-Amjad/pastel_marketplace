import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** ?status filter for the user list (matches AccountStatus: active|restricted|banned|deleted). */
export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() status?: string;
}

export class RestrictUserDto {
  @IsString() @MaxLength(2000) reason!: string;
}

export class UnrestrictUserDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class BanUserDto {
  @IsString() @MaxLength(2000) reason!: string;
}
