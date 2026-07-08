/** Typed application configuration, loaded from environment variables. */

export interface JwtConfig {
  accessSecret: string;
  accessTtl: string;
  refreshSecret: string;
  refreshTtl: string;
  refreshCookieName: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  jwt: JwtConfig;
  vapid: VapidConfig;
}

export const configuration = (): AppConfig => {
  const env = process.env.NODE_ENV ?? 'development';
  return {
    env,
    isProduction: env === 'production',
    port: parseInt(process.env.API_PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
      refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'oms_rt',
    },
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
      privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
      subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@oms.local',
    },
  };
};

/**
 * Fail fast on misconfiguration. In production, refuse to boot with missing
 * DATABASE_URL or default/placeholder JWT secrets.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const isProd = (config.NODE_ENV ?? 'development') === 'production';
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (see apps/api/.env.example).');
  }
  if (isProd) {
    const weak = (v: unknown) => !v || String(v).includes('change-me');
    if (weak(config.JWT_ACCESS_SECRET) || weak(config.JWT_REFRESH_SECRET)) {
      throw new Error('Strong JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production.');
    }
  }
  return config;
}
