import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ReadPrismaService } from './read-prisma.service';

/**
 * Global Prisma module. Exposes the write primary (PrismaService) and the read replica
 * (ReadPrismaService) to every module without re-importing.
 */
@Global()
@Module({
  providers: [PrismaService, ReadPrismaService],
  exports: [PrismaService, ReadPrismaService],
})
export class PrismaModule {}
