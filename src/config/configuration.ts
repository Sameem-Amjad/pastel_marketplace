/**
 * Typed runtime configuration. Loaded once at boot; injected via ConfigService.
 * Keep secrets OUT of code — everything comes from env (doc 01 §7).
 */
export interface AppConfig {
  env: string;
  port: number;
  isWorker: boolean;
  database: {
    url: string;
    directUrl: string;
    replicaUrl: string | null;
  };
  redisUrl: string;
  auth: {
    alg: string;
    secret: string;
    privateKey: string | null;
    publicKey: string | null;
    accessTtl: number;
    refreshTtl: number;
    cookieName: string;
    cookieDomain: string | null;
    csrfSecret: string;
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
    connectRefreshUrl: string | null;
    connectReturnUrl: string | null;
  };
  taxjar: { token: string | null; nexusStates: string[] };
  shippo: { token: string | null };
  admin: { operatorSecret: string | null };
  logLevel: string;
}

const bool = (v: string | undefined): boolean => v === 'true' || v === '1';
const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const orNull = (v: string | undefined): string | null => (v && v.length > 0 ? v : null);

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3500),
  isWorker: bool(process.env.WORKER),
  database: {
    url: process.env.DATABASE_URL ?? '',
    directUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
    replicaUrl: orNull(process.env.DATABASE_REPLICA_URL),
  },
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  auth: {
    alg: process.env.JWT_ALG ?? 'HS256',
    secret: process.env.JWT_SECRET ?? 'dev-only-change-me',
    privateKey: orNull(process.env.JWT_PRIVATE_KEY),
    publicKey: orNull(process.env.JWT_PUBLIC_KEY),
    accessTtl: int(process.env.JWT_ACCESS_TTL, 900),
    refreshTtl: int(process.env.JWT_REFRESH_TTL, 2_592_000),
    cookieName: process.env.COOKIE_NAME ?? 'pa_at',
    cookieDomain: orNull(process.env.COOKIE_DOMAIN),
    csrfSecret: process.env.CSRF_SECRET ?? 'dev-only-change-me',
  },
  stripe: {
    secretKey: orNull(process.env.STRIPE_SECRET_KEY),
    webhookSecret: orNull(process.env.STRIPE_WEBHOOK_SECRET),
    connectRefreshUrl: orNull(process.env.STRIPE_CONNECT_REFRESH_URL),
    connectReturnUrl: orNull(process.env.STRIPE_CONNECT_RETURN_URL),
  },
  taxjar: {
    token: orNull(process.env.TAXJAR_API_TOKEN),
    nexusStates: (process.env.TAX_JAR_NEXUS_STATES ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  },
  shippo: { token: orNull(process.env.SHIPPO_API_TOKEN) },
  admin: { operatorSecret: orNull(process.env.ADMIN_SECRET) },
  logLevel: process.env.LOG_LEVEL ?? 'info',
});
