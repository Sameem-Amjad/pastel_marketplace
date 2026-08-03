import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../../config/configuration';

/**
 * Read-replica Prisma client (doc 01 §2, doc 05 "read/write separation").
 *
 * Search, feeds, profiles, and listing-detail reads route here so they never contend with the write
 * primary. If DATABASE_REPLICA_URL is unset (single-node dev), it transparently points at the primary,
 * so application code can ALWAYS depend on this service without branching.
 *
 * IMPORTANT: replicas are eventually consistent. Never read-your-own-write through this client inside a
 * mutation flow — use PrismaService (primary) when you must observe a write you just made.
 */
@Injectable()
export class ReadPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReadPrismaService.name);

  constructor(config: ConfigService<AppConfig, true>) {
    const db = config.get('database', { infer: true });
    const url = db.replicaUrl ?? db.url;
    super({ datasources: { db: { url } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma (read replica) connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
