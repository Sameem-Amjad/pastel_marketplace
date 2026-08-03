import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface IdempotentResult {
  statusCode: number;
  response: Prisma.JsonValue;
}

/**
 * Inbound request idempotency (doc 01 §5.3, doc 04 §8).
 *
 * Clients send `Idempotency-Key` on mutating endpoints (checkout, refund). If the same key is replayed
 * (network retry, double-tap), we return the stored response instead of charging/refunding twice.
 *
 * The key is unique per scope; a second concurrent insert with the same key hits the PK and is caught,
 * letting the caller fall back to the stored response once the first request commits.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(key: string): Promise<IdempotentResult | null> {
    const row = await this.prisma.idempotencyKey.findUnique({ where: { key } });
    if (!row || row.statusCode === null || row.response === null) return null;
    return { statusCode: row.statusCode, response: row.response };
  }

  /** Reserve a key before doing work. Returns false if it already exists (replay). */
  async reserve(key: string, scope: string): Promise<boolean> {
    try {
      await this.prisma.idempotencyKey.create({ data: { key, scope } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false; // key already reserved → replay
      }
      throw e;
    }
  }

  async store(key: string, statusCode: number, response: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: { statusCode, response },
    });
  }
}
