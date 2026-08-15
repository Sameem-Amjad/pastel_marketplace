import { Module } from '@nestjs/common';
import { AdminModerationController } from './controllers/admin-moderation.controller';
import { AdminModerationService } from './services/admin-moderation.service';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminUsersService } from './services/admin-users.service';
import { AuditService } from './services/audit.service';
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
