import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Query for GET /admin/reports. */
export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'open',
    description: 'Filter by report status. Omit to list every status.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  /** ?isDmca=true / false — coerced from the query string (implicit conversion is disabled globally). */
  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description: 'Filter to DMCA takedown reports (`true`) or non-DMCA reports (`false`).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isDmca?: boolean;
}

/** Body for POST /admin/reports/{id}/resolve. */
export class ResolveReportDto {
  @ApiProperty({
    maxLength: 50,
    example: 'actioned',
    description: 'Terminal status to record for this report (e.g. `actioned`, `dismissed`).',
  })
  @IsString()
  @MaxLength(50)
  status!: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    example: 'Listing removed and seller warned.',
    description: 'Operator note kept with the report for audit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Query for GET /admin/appeals. */
export class ListAppealsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'pending',
    description: 'Filter by appeal status. Omit to list every status.',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

/** Body for POST /admin/appeals/{id}/review. */
export class ReviewAppealDto {
  @ApiProperty({
    maxLength: 50,
    example: 'upheld',
    description: 'Decision to record (e.g. `upheld`, `rejected`).',
  })
  @IsString()
  @MaxLength(50)
  status!: string;

  @ApiProperty({
    maxLength: 2000,
    example: 'Evidence of provenance accepted; restriction lifted.',
    description:
      'Reasoning for the decision. Required — appeals must be justified in the audit trail.',
  })
  @IsString()
  @MaxLength(2000)
  adminNote!: string;
}

/** Query for GET /admin/waitlist. */
export class ListWaitlistQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'pending',
    description: 'Filter by waitlist status. Omit to list every status.',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

/** Query for GET /admin/deletion-requests. */
export class ListDeletionRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'pending',
    description: 'Filter by request status. Omit to list every status.',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
