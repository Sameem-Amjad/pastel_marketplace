import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Append-only operator audit trail (AuditLog). EVERY mutating admin action must call log() — this is a
 * hard requirement, so operator actions are always attributable.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert one AuditLog row. `actor` is the operator id (req.principal.userId). `detail` is an arbitrary
   * JSON payload describing the change (reason, before/after status, etc.).
   */
  async log(
    actor: string,
    action: string,
    entityType: string,
    entityId?: string,
    detail?: Prisma.InputJsonValue,
  ): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        actor,
        action,
        entityType,
        entityId: entityId ?? null,
        detail: detail ?? {},
      },
    });
  }
}
