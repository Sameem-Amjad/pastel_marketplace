import { ApiProperty } from '@nestjs/swagger';

/**
 * Notification preference maps. Both are client-owned free-form JSON — the server stores and returns
 * them without interpreting their inner shape, so new notification types need no backend change.
 */
export class NotificationPreferencesResource {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { 'order.purchased': 'high', 'social.follow': 'low' },
    description: 'Per-type delivery priority: `{ [type]: "low" | "default" | "high" }`.',
  })
  priorities!: unknown;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { buyer: { 'order.shipped': true }, seller: { 'order.purchased': true } },
    description: 'Per-mode opt-in: `{ buyer|seller: { [type]: boolean } }`.',
  })
  enabled!: unknown;
}
