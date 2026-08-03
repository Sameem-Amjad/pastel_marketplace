import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { PushTokenController } from './push-token.controller';

/**
 * Notifications (in-app feed, preferences, push-token registry). PrismaService and ReadPrismaService
 * come from the global PrismaModule, so nothing extra needs importing here.
 *
 * NotificationService is exported as the reusable seam other modules (orders, social, live shows)
 * inject to enqueue notifications — they never touch the Notification table directly.
 */
@Module({
  controllers: [NotificationsController, PushTokenController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
