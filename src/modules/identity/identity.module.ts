import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../config/configuration';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { AuthGuard } from './guards/auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { ScopesGuard } from './guards/scopes.guard';
import { MeController } from './controllers/me.controller';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';

/**
 * Identity & Auth (doc 06). Registers AuthGuard → ScopesGuard → PermissionsGuard GLOBALLY (in order):
 *   AuthGuard       resolves req.principal on every request (anonymous if no token)
 *   ScopesGuard     enforces @Scopes(...) (401/403)
 *   PermissionsGuard enforces @RequirePermission(...) (no-op when absent)
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const auth = config.get('auth', { infer: true });
        const isAsymmetric = auth.alg === 'RS256' || auth.alg === 'ES256';
        if (isAsymmetric && auth.privateKey && auth.publicKey) {
          return {
            privateKey: auth.privateKey,
            publicKey: auth.publicKey,
            signOptions: { algorithm: auth.alg as 'RS256' | 'ES256' },
            verifyOptions: { algorithms: [auth.alg as 'RS256' | 'ES256'] },
          };
        }
        // Dev fallback: symmetric HS256.
        return {
          secret: auth.secret,
          signOptions: { algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ScopesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, TokenService, PasswordService],
})
export class IdentityModule {}
