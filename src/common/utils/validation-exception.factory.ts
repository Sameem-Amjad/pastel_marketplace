import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { CommonResponseMessage } from '../constants/response-message';
import { FieldError } from '../interfaces/api-response.interface';

/**
 * Turns class-validator's nested ValidationError tree into the flat `[{ field, message }]` array the
 * error envelope promises.
 *
 * Nest's default factory collapses everything into a `string[]` of prose ("email must be an email"),
 * which forces the client to string-match to highlight a form field. Keeping the property path lets
 * the Expo form bind each message to its input directly.
 */
export function toFieldErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    const own: FieldError[] = Object.values(error.constraints ?? {}).map((message) => ({
      field: path,
      message,
    }));

    // `children` is populated for nested objects and array items (@ValidateNested).
    const nested = error.children?.length ? toFieldErrors(error.children, path) : [];

    return [...own, ...nested];
  });
}

/**
 * The global ValidationPipe's `exceptionFactory`. The thrown exception carries the field errors on a
 * dedicated `errors` key, which HttpExceptionFilter lifts into `errors.value`.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException({
    message: CommonResponseMessage.fail.VALIDATION_FAILED,
    errors: toFieldErrors(errors),
  });
}
