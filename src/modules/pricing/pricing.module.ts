import { Module } from '@nestjs/common';
import { PricingService } from './services/pricing.service';

@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
