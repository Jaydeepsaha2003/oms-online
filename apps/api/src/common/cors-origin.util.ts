import type { AppConfig } from '../config/configuration';

const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;

export type CorsOriginOption =
  | string[]
  | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);

/**
 * Shared by the HTTP API and the WebSocket gateway: in production, only the
 * configured CORS_ORIGINS are allowed; otherwise any localhost/private-LAN
 * origin is allowed too, so phones/other devices on the same network can
 * reach the app (mirrors the reasoning in vite.config.ts's mkcert setup).
 */
export function buildCorsOrigin(cfg: Pick<AppConfig, 'isProduction' | 'corsOrigins'>): CorsOriginOption {
  if (cfg.isProduction) return cfg.corsOrigins;
  return (origin, callback) => {
    const allowed = !origin || cfg.corsOrigins.includes(origin) || PRIVATE_LAN_ORIGIN.test(origin);
    callback(null, allowed);
  };
}
