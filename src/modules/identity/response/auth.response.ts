import { ApiProperty } from '@nestjs/swagger';
import { UserResource } from '../mappers/user.mapper';

/**
 * Payloads of the session endpoints.
 *
 * The refresh token is deliberately absent from every one of these: it is set as an httpOnly cookie
 * (`pa_rt`, scoped to /auth) so web clients cannot read it from JS. React Native has no cookie jar
 * shared with the WebView, so the Expo app reads the refresh token from the `Set-Cookie` header at
 * login and stores it in SecureStore, then passes it back in the `POST /auth/refresh` body.
 */

/** Returned by signup and login: the user plus a ready-to-use access token. */
export class SessionResource {
  @ApiProperty({ type: UserResource, description: 'The authenticated user.' })
  user!: UserResource;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT to send as `Authorization: Bearer <token>` on subsequent requests.',
  })
  accessToken!: string;

  @ApiProperty({
    example: 900,
    description: 'Access-token lifetime in seconds. Refresh before it elapses.',
  })
  expiresIn!: number;
}

/** Returned by refresh: a new access token only — the user has not changed. */
export class AccessTokenResource {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;
}
