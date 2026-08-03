import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PricingModule } from '../pricing/pricing.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { FakePaymentGateway } from './gateway/fake-payment-gateway';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { StripePaymentGateway } from './gateway/stripe-payment-gateway';
import { OrderStateMachine } from './order-state-machine.service';
import { OrdersController } from './orders.controller';
import { ScheduledTransitionWorker } from './scheduled-transition.worker';

/**
 * Orders / Payments (doc 04). The payment gateway is chosen at boot: real Stripe Connect when
 * STRIPE_SECRET_KEY is set, otherwise the in-memory fake (dev/CI) — so the whole order lifecycle runs
 * end-to-end without Stripe credentials.
 */
@Module({
  imports: [PricingModule],
  controllers: [OrdersController, CheckoutController],
  providers: [
    OrderStateMachine,
    CheckoutService,
    ScheduledTransitionWorker,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const key = config.get('stripe', { infer: true }).secretKey;
        return key ? new StripePaymentGateway(key) : new FakePaymentGateway();
      },
    },
  ],
  exports: [OrderStateMachine, CheckoutService],
})
export class OrdersModule {}
