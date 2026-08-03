import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { AppConfig } from '../../../config/configuration';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AccessClaims, Principal, Scope } from '../auth.types';
import { PasswordService } from './password.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Token issuance + rotating refresh tokens (doc 06 §2).
 *
 * Access token: short-lived JWT, stateless verification.
 * Refresh token: opaque, ROTATING, stored hashed. Format `<credentialId>.<secret>`; only the argon2 hash
 *   of <secret> is persisted. On every use the old credential is revoked and a new one issued within the
 *   same `family`. Presenting an already-revoked token (reuse) revokes the WHOLE family — the standard
 *   refresh-token-theft defense.
 */
@Injectable()
export class TokenService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    config: ConfigService<AppConfig, true>,
  ) {
    const auth = config.get('auth', { infer: true });
    this.accessTtl = auth.accessTtl;
    this.refreshTtl = auth.refreshTtl;
  }

  signAccess(principal: Principal & { userId: string }, ver = 0): string {
    const claims: AccessClaims = {
      sub: principal.userId,
      scope: principal.scope,
      userType: principal.userType ?? 'customer',
      ver,
    };
    return this.jwt.sign(claims, { expiresIn: this.accessTtl });
  }

  verifyAccess(token: string): AccessClaims {
    try {
      return this.jwt.verify<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  /** Issue a brand-new refresh credential (login / signup). Starts a new family. */
  async issueRefresh(
    userId: string,
    scope: Scope,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<{ token: string; family: string }> {
    const family = uuidv7();
    const token = await this.createCredential(userId, scope, family, meta);
    return { token, family };
  }

  /** Mint a full access+refresh pair for a freshly authenticated user. */
  async issuePair(
    principal: Principal & { userId: string },
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<TokenPair> {
    const { token } = await this.issueRefresh(principal.userId, principal.scope, meta);
    return { accessToken: this.signAccess(principal), refreshToken: token, expiresIn: this.accessTtl };
  }

  /** Rotate a refresh token. Throws (and burns the family) on reuse. */
  async rotate(
    rawToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<TokenPair & { userId: string; scope: Scope; userType: string }> {
    const [credentialId, secret] = rawToken.split('.');
    if (!credentialId || !secret) throw new UnauthorizedException('Malformed refresh token');

    const cred = await this.prisma.credential.findUnique({ where: { id: credentialId } });
    if (!cred) throw new UnauthorizedException('Unknown refresh token');

    // Reuse detection: a revoked credential being presented means the token was stolen/replayed.
    if (cred.revokedAt) {
      if (cred.family) {
        await this.prisma.credential.updateMany({
          where: { family: cred.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token reuse detected; session revoked');
    }
    if (cred.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    const ok = await this.passwords.verify(cred.refreshHash, secret);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.prisma.user.findUnique({ where: { id: cred.userId } });
    if (!user || user.accountStatus === 'banned' || user.accountStatus === 'deleted') {
      throw new UnauthorizedException('Account unavailable');
    }

    // Rotate: revoke old, issue new within the same family.
    await this.prisma.credential.update({ where: { id: cred.id }, data: { revokedAt: new Date() } });
    const scope = cred.scope as Scope;
    const newToken = await this.createCredential(cred.userId, scope, cred.family ?? uuidv7(), meta);
    const principal: Principal & { userId: string } = {
      userId: user.id,
      scope,
      userType: user.userType,
    };
    return {
      accessToken: this.signAccess(principal),
      refreshToken: newToken,
      expiresIn: this.accessTtl,
      userId: user.id,
      scope,
      userType: user.userType,
    };
  }

  async revoke(rawToken: string): Promise<void> {
    const [credentialId] = rawToken.split('.');
    if (!credentialId) return;
    await this.prisma.credential.updateMany({
      where: { id: credentialId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createCredential(
    userId: string,
    scope: Scope,
    family: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    const refreshHash = await this.passwords.hash(secret);
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000);
    const cred = await this.prisma.credential.create({
      data: { userId, scope, family, refreshHash, expiresAt, userAgent: meta.userAgent, ip: meta.ip },
    });
    return `${cred.id}.${secret}`;
  }
}
