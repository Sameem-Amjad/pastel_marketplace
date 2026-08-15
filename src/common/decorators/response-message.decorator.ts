import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response:message';

/**
 * Declares the success message the ResponseInterceptor puts in the envelope's `message` field.
 *
 * Always pass a constant from the module's `response/response-message.ts` so every string the app can
 * display is declared in one file per domain:
 *
 *   @ResponseMessage(CatalogResponseMessage.success.LISTING_CREATED)
 *   @Post()
 *   create(...) { ... }
 *
 * May be applied to a controller class to set a default for all of its handlers; the handler-level
 * decorator wins. Without it, the interceptor falls back to
 * `CommonResponseMessage.success.REQUEST_SUCCEEDED`.
 */
export const ResponseMessage = (message: string): MethodDecorator & ClassDecorator =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
