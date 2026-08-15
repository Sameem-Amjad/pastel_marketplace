import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Principal } from '../entities/auth.types';
import { LoginDto, SignupDto } from '../dto/auth.dto';
import { AuthResponseMessage } from '../response/response-message';
import { PasswordService } from './password.service';
import { TokenPair, TokenService } from './token.service';

export interface AuthResult {
  user: User;
  tokens: TokenPair;
}

/** Shape returned by GET /auth/info (== sdk.authInfo). The frontend boots off this BEFORE /me. */
export class AuthInfo {
  @ApiProperty({
    example: false,
    description: 'True when the request carried no valid access token.',
  })
  isAnonymous!: boolean;

  @ApiProperty({
    type: [String],
    example: ['user'],
    description: 'Granted scopes: `public-read`, `user`, or `trusted`.',
  })
  scopes!: string[];

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'The signed-in user, or null when anonymous.',
  })
  userId!: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * "Effectively verified" (doc 02 §3, doc 06): a user counts as verified if ANY of
   * emailVerified OR protectedData.buyerEmailVerified OR protectedData.waitlistVerified is true.
   */
  static isEffectivelyVerified(user: Pick<User, 'emailVerified' | 'protectedData'>): boolean {
    if (user.emailVerified) return true;
    const pd = (user.protectedData ?? {}) as Record<string, unknown>;
    return pd.buyerEmailVerified === true || pd.waitlistVerified === true;
  }

  /**
   * Registers a new email/password account.
   *
   * Steps:
   * 1. Normalise the email (lowercase + trim) and reject a duplicate → 409.
   * 2. Hash the password with argon2 — the plaintext is never stored or logged.
   * 3. Stamp `agreedToTermsAt` and create the user with default permissions.
   * 4. Issue an access/refresh token pair bound to the caller's device metadata.
   */
  async signup(dto: SignupDto, meta: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException(AuthResponseMessage.fail.EMAIL_ALREADY_EXISTS);

    const passwordHash = await this.passwords.hash(dto.password);

    // Capture agreedToTermsAt on email/password signup too (doc AUTH-15: default both transports).
    const protectedData: Prisma.InputJsonValue = { agreedToTermsAt: new Date().toISOString() };

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: dto.displayName,
        protectedData,
        permissions: { create: {} }, // defaults: all permission/allow
      },
    });

    const tokens = await this.tokens.issuePair(
      { userId: user.id, scope: 'user', userType: user.userType },
      meta,
    );
    return { user, tokens };
  }

  /**
   * Authenticates an email/password pair.
   *
   * Steps:
   * 1. Look the user up by normalised email.
   * 2. Verify the password hash.
   * 3. Refuse banned/deleted accounts → 403.
   * 4. Issue an access/refresh token pair.
   *
   * Unknown email and wrong password return the *same* 401 message on purpose — distinguishing them
   * would turn this endpoint into an account-enumeration oracle.
   */
  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException(AuthResponseMessage.fail.INVALID_CREDENTIALS);

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException(AuthResponseMessage.fail.INVALID_CREDENTIALS);

    if (user.accountStatus === 'banned' || user.accountStatus === 'deleted') {
      throw new ForbiddenException(AuthResponseMessage.fail.ACCOUNT_BANNED);
    }

    const tokens = await this.tokens.issuePair(
      { userId: user.id, scope: 'user', userType: user.userType },
      meta,
    );
    return { user, tokens };
  }

  /**
   * Exchanges a refresh token for a fresh pair (rotating refresh — the presented token is consumed).
   * Replay of an already-rotated token is treated as theft by TokenService and revokes the family.
   */
  refresh(rawToken: string, meta: { userAgent?: string; ip?: string }) {
    return this.tokens.rotate(rawToken, meta);
  }

  /** Revokes the presented refresh token. Idempotent — logging out twice is not an error. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revoke(rawToken);
  }

  /** Projects the resolved principal into the boot payload the client gates its first render on. */
  buildAuthInfo(principal: Principal): AuthInfo {
    return {
      isAnonymous: principal.scope === 'public-read',
      scopes: [principal.scope],
      userId: principal.userId,
    };
  }

  /**
   * Loads the signed-in user's full row. A valid token for a since-deleted user yields 401, not 404 —
   * the credential is what has become invalid.
   */
  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException(AuthResponseMessage.fail.USER_NOT_FOUND);
    return user;
  }
}
