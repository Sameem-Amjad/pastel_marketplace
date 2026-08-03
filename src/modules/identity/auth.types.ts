import { Request } from 'express';

/** AuthZ scopes (doc 01 §5.6, doc 06 §2). */
export type Scope = 'public-read' | 'user' | 'trusted';

/** The resolved caller. Anonymous callers have scope 'public-read' and no userId. */
export interface Principal {
  userId: string | null;
  scope: Scope;
  userType: string | null;
}

export const ANONYMOUS: Principal = { userId: null, scope: 'public-read', userType: null };

/** Access-token claims. `ver` lets us invalidate all tokens for a user by bumping a stored version. */
export interface AccessClaims {
  sub: string;
  scope: Scope;
  userType: string;
  ver: number;
}

export interface AuthenticatedRequest extends Request {
  principal: Principal;
}
