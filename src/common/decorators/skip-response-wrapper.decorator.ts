import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_WRAPPER_KEY = 'response:skip-wrapper';

/**
 * Opts a handler (or a whole controller) out of the success envelope, so its return value is written
 * to the wire exactly as-is.
 *
 * Reserve this for endpoints whose consumer is not our app and therefore cannot be asked to unwrap:
 * load-balancer health probes, and any third-party webhook ack (Stripe et al.) whose body shape is
 * dictated by the caller. Everything the Expo client touches must stay wrapped.
 */
export const SkipResponseWrapper = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RESPONSE_WRAPPER_KEY, true);
