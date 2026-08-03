import { SetMetadata } from '@nestjs/common';
import { Scope } from '../auth.types';

export const SCOPES_KEY = 'required_scopes';

/**
 * Declare the minimum scope(s) an endpoint requires. Enforced by ScopesGuard.
 *   @Scopes('user')      → must be logged in
 *   @Scopes('trusted')   → server-to-server only (never minted for a browser)
 * Endpoints with no @Scopes are public-read.
 */
export const Scopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);
