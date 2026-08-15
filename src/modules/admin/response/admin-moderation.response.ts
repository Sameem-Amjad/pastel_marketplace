import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger models for the moderation queues.
 *
 * The moderation endpoints return their Prisma rows directly — these classes exist only so `/docs`
 * shows the real fields instead of an opaque object. They mirror `prisma/schema.prisma`; if a model
 * there gains a column, add it here too.
 *
 * These are operator-only payloads: they contain reporter emails and appellant details, and must never
 * be surfaced in the consumer app.
 */

/** A user-submitted report against a listing, story, or user. */
export class ContentReportResource {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'listing',
    description: 'What was reported: `listing`, `story`, `user`, ...',
  })
  contentType!: string;

  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Id of the reported content.',
  })
  contentId!: string;

  @ApiProperty({ example: 'counterfeit', description: 'Reporter-selected reason code.' })
  reason!: string;

  @ApiProperty({
    example: false,
    description: 'True for DMCA takedown notices, which are triaged first.',
  })
  isDmca!: boolean;

  @ApiProperty({
    nullable: true,
    example: 'Same photos as another shop.',
    description: 'Free-text detail.',
  })
  details!: string | null;

  @ApiProperty({ nullable: true, example: 'reporter@example.com' })
  reporterEmail!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Reporter, when they were signed in.',
  })
  reporterUserId!: string | null;

  @ApiProperty({ example: 'open', description: '`open` until an operator resolves it.' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/** A restricted user's appeal against their restriction. */
export class RestrictionAppealResource {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'The restricted user.' })
  userId!: string;

  @ApiProperty({ nullable: true, example: 'seller@example.com' })
  email!: string | null;

  @ApiProperty({ nullable: true, example: 'Restriction appeal' })
  subject!: string | null;

  @ApiProperty({ nullable: true, description: "The appellant's case." })
  description!: string | null;

  @ApiProperty({ nullable: true, description: 'Supporting evidence uploaded by the appellant.' })
  attachmentUrl!: string | null;

  @ApiProperty({ nullable: true, example: 'individual' })
  userType!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Why the account was restricted in the first place.',
  })
  restrictionReason!: string | null;

  @ApiProperty({ example: 'pending', description: '`pending` until reviewed.' })
  status!: string;

  @ApiProperty({ nullable: true, description: 'Operator reasoning recorded at review time.' })
  adminNote!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Operator who reviewed it.' })
  adminActor!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** A pre-launch waitlist entry. */
export class WaitlistResource {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'john@example.com', description: 'Unique across the waitlist.' })
  email!: string;

  @ApiProperty({ nullable: true, example: 'John Doe' })
  name!: string | null;

  @ApiProperty({ nullable: true, example: '+441234567890' })
  phone!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'seller',
    description: 'How they intend to use the marketplace.',
  })
  role!: string | null;

  @ApiProperty({ example: 'pending_verification' })
  status!: string;

  @ApiProperty({ example: 0, description: 'Manual queue priority; higher is approved sooner.' })
  priority!: number;

  @ApiProperty({ nullable: true, description: 'Token this entry shares to refer others.' })
  referralToken!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Who referred this entry.' })
  referredById!: string | null;

  @ApiProperty({ example: 0, description: 'How many sign-ups this entry referred.' })
  referralCount!: number;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Set once the entry becomes an account.',
  })
  userId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/** A GDPR/CCPA account-deletion request awaiting operator action. */
export class AccountDeletionRequestResource {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'The account to delete, when resolvable.',
  })
  userId!: string | null;

  @ApiProperty({ example: 'john@example.com', description: 'Email the request came from.' })
  email!: string;

  @ApiProperty({ nullable: true, example: 'individual' })
  userType!: string | null;

  @ApiProperty({ example: 'pending', description: '`pending` or `completed`.' })
  status!: string;

  @ApiProperty({ nullable: true, description: 'What was done, recorded on completion.' })
  resolution!: string | null;

  @ApiProperty({ format: 'date-time' })
  requestedAt!: Date;

  @ApiProperty({ format: 'date-time', nullable: true })
  completedAt!: Date | null;
}
