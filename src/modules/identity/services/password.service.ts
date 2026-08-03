import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing — Argon2id (doc 01 §3, doc 06 §2). OWASP-recommended params.
 * passwordHash is null for IdP-only accounts; verify() returns false for those.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string | null, plain: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
