import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Principal } from './auth.types';
import { LoginDto, SignupDto } from './dto/auth.dto';
import { PasswordService } from './services/password.service';
import { TokenPair, TokenService } from './services/token.service';

export interface AuthResult {
  user: User;
  tokens: TokenPair;
}

/** Shape returned by GET /auth/info (== sdk.authInfo). The frontend boots off this BEFORE /me. */
export interface AuthInfo {
  isAnonymous: boolean;
  scopes: string[];
  userId: string | null;
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

  async signup(dto: SignupDto, meta: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

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

  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (user.accountStatus === 'banned' || user.accountStatus === 'deleted') {
      throw new ForbiddenException('Account unavailable');
    }

    const tokens = await this.tokens.issuePair(
      { userId: user.id, scope: 'user', userType: user.userType },
      meta,
    );
    return { user, tokens };
  }

  refresh(rawToken: string, meta: { userAgent?: string; ip?: string }) {
    return this.tokens.rotate(rawToken, meta);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revoke(rawToken);
  }

  buildAuthInfo(principal: Principal): AuthInfo {
    return {
      isAnonymous: principal.scope === 'public-read',
      scopes: [principal.scope],
      userId: principal.userId,
    };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }
}
