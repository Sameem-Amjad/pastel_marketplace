import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderStateMachine } from './order-state-machine.service';

/**
 * Timer poller (doc 01 §5.5) — replaces Sharetribe's EDN time-based transitions (PT15M/P3D/P14D/P7D).
 *
 * Every ~30s it claims due `ScheduledTransition` rows and fires them. The `guardState` is the safety net:
 * apply() re-asserts the order is still in that state under a row lock, so a timer that has been
 * superseded (the buyer already acted) becomes a no-op (marked skipped) instead of a wrong transition.
 * Only runs on worker replicas (WORKER=true); API replicas don't poll.
 */
@Injectable()
export class ScheduledTransitionWorker {
  private readonly logger = new Logger(ScheduledTransitionWorker.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fsm: OrderStateMachine,
    config: ConfigService<AppConfig, true>,
  ) {
    this.enabled = config.get('isWorker', { infer: true });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    if (!this.enabled) return;

    // Claim a batch atomically: flip pending→firing for due rows and return them (skip-locked semantics
    // via the partial index ScheduledTransition_pending_runAt_idx).
    const due = await this.prisma.scheduledTransition.findMany({
      where: { status: 'pending', runAt: { lte: new Date() } },
      orderBy: { runAt: 'asc' },
      take: 100,
    });

    for (const row of due) {
      try {
        const order = await this.prisma.order.findUnique({ where: { id: row.orderId } });
        if (!order || order.state !== row.guardState) {
          // superseded — the order moved on; this timer no longer applies.
          await this.prisma.scheduledTransition.update({ where: { id: row.id }, data: { status: 'skipped' } });
          continue;
        }
        await this.fsm.apply(row.orderId, row.transition, 'system');
        await this.prisma.scheduledTransition.update({ where: { id: row.id }, data: { status: 'fired' } });
      } catch (e) {
        this.logger.error(`scheduled ${row.transition} for order ${row.orderId} failed: ${(e as Error).message}`);
        await this.prisma.scheduledTransition.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
        });
      }
    }
  }
}
