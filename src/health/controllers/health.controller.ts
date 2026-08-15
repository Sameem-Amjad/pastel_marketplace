import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipResponseWrapper } from '../../common/decorators/skip-response-wrapper.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Liveness/readiness probes (doc 01 §7). /healthz is cheap (process up);
 * /readyz verifies the DB is reachable before the LB sends traffic.
 *
 * These are the only endpoints exempt from the response envelope and from the `/api/v1` prefix: the
 * consumer is the load balancer and the container orchestrator, not our app, and neither can be asked
 * to unwrap `data.value` or to follow a version bump. They are hidden from `/docs` for the same reason.
 *
 * Both exemptions are needed: `setGlobalPrefix({ exclude })` in main.ts drops the `/api` segment, and
 * VERSION_NEUTRAL here drops the `/v1` one — versioning is applied independently of the prefix, so
 * without this the probes would answer on `/v1/healthz` and every deployed probe config would break.
 */
@ApiExcludeController()
@SkipResponseWrapper()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up and serving. Does not touch the database. */
  @Get('healthz')
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: the database answers, so this instance can take traffic. */
  @Get('readyz')
  async readyz(): Promise<{ status: string; db: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok' };
  }
}
