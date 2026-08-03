import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountDeletionRequest,
  ContentReport,
  Prisma,
  RestrictionAppeal,
  Waitlist,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReadPrismaService } from '../../common/prisma/read-prisma.service';
import { buildPage, decodeCursor, Cursor, Page } from '../../common/pagination/cursor.util';
import { AuditService } from './audit.service';

/** A row with the (createdAt, id) keyset columns every list here paginates on. */
interface KeysetRow {
  id: string;
  createdAt: Date;
}

/** One OR-branch of a (createdAt, id) keyset seek. The shape is identical across all these models. */
interface KeysetBranch {
  createdAt?: { lt: Date } | Date;
  id?: { lt: string };
}

/** Build the `OR` keyset-seek clause for "rows after the previous page" given an opaque cursor token. */
function keysetSeek(cursorToken: string | undefined): KeysetBranch[] | undefined {
  const cursor = cursorToken ? decodeCursor(cursorToken) : null;
  if (!cursor) return undefined;
  return [
    { createdAt: { lt: new Date(cursor.v) } },
    { createdAt: new Date(cursor.v), id: { lt: cursor.id } },
  ];
}

const toKeysetCursor = (row: KeysetRow): Cursor => ({ v: row.createdAt.toISOString(), id: row.id });

@Injectable()
export class AdminModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── content reports ──────────────────────────────────────────────────────────
  async listReports(
    perPage: number,
    cursor?: string,
    status?: string,
    isDmca?: boolean,
  ): Promise<Page<ContentReport>> {
    const where: Prisma.ContentReportWhereInput = {};
    if (status) where.status = status;
    if (isDmca !== undefined) where.isDmca = isDmca;
    where.OR = keysetSeek(cursor);

    const rows = await this.read.contentReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: perPage + 1,
    });
    return buildPage(rows, perPage, toKeysetCursor);
  }

  async resolveReport(operatorId: string, id: string, status: string, note?: string): Promise<ContentReport> {
    const existing = await this.prisma.contentReport.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Report not found');

    const report = await this.prisma.contentReport.update({ where: { id }, data: { status } });
    await this.audit.log(operatorId, 'report.resolve', 'ContentReport', id, { status, note: note ?? null });
    return report;
  }

  // ── restriction appeals ──────────────────────────────────────────────────────
  async listAppeals(perPage: number, cursor?: string, status?: string): Promise<Page<RestrictionAppeal>> {
    const where: Prisma.RestrictionAppealWhereInput = {};
    if (status) where.status = status;
    where.OR = keysetSeek(cursor);

    const rows = await this.read.restrictionAppeal.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: perPage + 1,
    });
    return buildPage(rows, perPage, toKeysetCursor);
  }

  async reviewAppeal(
    operatorId: string,
    id: string,
    status: string,
    adminNote: string,
  ): Promise<RestrictionAppeal> {
    const existing = await this.prisma.restrictionAppeal.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Appeal not found');

    const appeal = await this.prisma.restrictionAppeal.update({
      where: { id },
      data: { status, adminNote, adminActor: operatorId, reviewedAt: new Date() },
    });
    await this.audit.log(operatorId, 'appeal.review', 'RestrictionAppeal', id, { status, adminNote });
    return appeal;
  }

  // ── waitlist ─────────────────────────────────────────────────────────────────
  async listWaitlist(perPage: number, cursor?: string, status?: string): Promise<Page<Waitlist>> {
    const where: Prisma.WaitlistWhereInput = {};
    if (status) where.status = status;
    where.OR = keysetSeek(cursor);

    const rows = await this.read.waitlist.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: perPage + 1,
    });
    return buildPage(rows, perPage, toKeysetCursor);
  }

  async approveWaitlist(operatorId: string, id: string): Promise<Waitlist> {
    const existing = await this.prisma.waitlist.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Waitlist entry not found');

    const entry = await this.prisma.waitlist.update({ where: { id }, data: { status: 'approved' } });
    await this.audit.log(operatorId, 'waitlist.approve', 'Waitlist', id, {});
    return entry;
  }

  // ── account deletion requests ─────────────────────────────────────────────────
  async listDeletionRequests(
    perPage: number,
    cursor?: string,
    status?: string,
  ): Promise<Page<AccountDeletionRequest>> {
    const where: Prisma.AccountDeletionRequestWhereInput = {};
    if (status) where.status = status;

    // This model's timestamp is `requestedAt`, not `createdAt` — keyset on (requestedAt, id).
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (decoded) {
      where.OR = [
        { requestedAt: { lt: new Date(decoded.v) } },
        { requestedAt: new Date(decoded.v), id: { lt: decoded.id } },
      ];
    }

    const rows = await this.read.accountDeletionRequest.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: perPage + 1,
    });
    return buildPage(rows, perPage, (row) => ({ v: row.requestedAt.toISOString(), id: row.id }));
  }

  async completeDeletionRequest(operatorId: string, id: string): Promise<AccountDeletionRequest> {
    const existing = await this.prisma.accountDeletionRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Deletion request not found');

    const request = await this.prisma.accountDeletionRequest.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await this.audit.log(operatorId, 'deletionRequest.complete', 'AccountDeletionRequest', id, {});
    return request;
  }
}
