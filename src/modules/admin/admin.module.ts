import { Module } from '@nestjs/common';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuditService } from './audit.service';
import { OperatorGuard } from './guards/operator.guard';

/**
 * Admin / Ops module (operator surface). Every controller is gated by OperatorGuard + @Scopes('user');
 * every mutating action is written to the AuditLog via AuditService.
 *
 * PrismaService / ReadPrismaService come from the @Global PrismaModule, so no imports are needed here.
 */
@Module({
  controllers: [AdminUsersController, AdminModerationController],
  providers: [AdminUsersService, AdminModerationService, AuditService, OperatorGuard],
})
export class AdminModule {}
