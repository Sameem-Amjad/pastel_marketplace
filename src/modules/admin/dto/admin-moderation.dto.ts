import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ListReportsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() status?: string;

  /** ?isDmca=true / false — coerced from the query string (implicit conversion is disabled globally). */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isDmca?: boolean;
}

export class ResolveReportDto {
  @IsString() @MaxLength(50) status!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class ListAppealsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() status?: string;
}

export class ReviewAppealDto {
  @IsString() @MaxLength(50) status!: string;
  @IsString() @MaxLength(2000) adminNote!: string;
}

export class ListWaitlistQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() status?: string;
}

export class ListDeletionRequestsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() status?: string;
}
