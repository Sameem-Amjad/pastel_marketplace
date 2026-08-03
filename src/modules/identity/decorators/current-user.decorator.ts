import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, Principal } from '../auth.types';

/** Inject the resolved Principal into a handler param: `@CurrentUser() principal: Principal`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.principal;
  },
);
