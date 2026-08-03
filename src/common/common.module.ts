import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency/idempotency.service';
import { OutboxService } from './outbox/outbox.service';

/**
 * Cross-cutting platform services that every domain module reuses (outbox, idempotency).
 * Global so modules don't re-import. Prisma lives in its own global module.
 */
@Global()
@Module({
  providers: [OutboxService, IdempotencyService],
  exports: [OutboxService, IdempotencyService],
})
export class CommonModule {}
