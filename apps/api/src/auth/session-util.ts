import type { SessionDto } from '@oms/shared';

/** Strip IPv6-mapped IPv4 prefix and normalise loopback for display. */
export function normaliseIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  let out = ip.trim();
  if (out.startsWith('::ffff:')) out = out.slice(7);
  if (out === '::1') out = '127.0.0.1';
  return out || null;
}

/** Offline location label from an IP — no external lookup. */
export function describeLocation(ip: string | null): string {
  if (!ip) return 'Unknown';
  if (ip === '127.0.0.1' || ip === 'localhost') return 'This device';
  // RFC1918 private + link-local + IPv6 ULA/link-local → LAN.
  if (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^(fc|fd|fe80)/i.test(ip)
  ) {
    return 'Local network';
  }
  return 'External network';
}

/** Parse a user-agent into browser / OS / device type (offline, no dependency). */
export function parseUserAgent(ua: string | null | undefined): {
  browser: string;
  os: string;
  deviceType: string;
  label: string;
} {
  const s = ua ?? '';
  if (!s) return { browser: 'Unknown', os: 'Unknown', deviceType: 'unknown', label: 'Unknown device' };

  const os = /Windows NT/.test(s)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(s)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(s)
        ? 'macOS'
        : /Android/.test(s)
          ? 'Android'
          : /Linux/.test(s)
            ? 'Linux'
            : 'Unknown';

  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /Chrome\//.test(s)
        ? 'Chrome'
        : /Firefox\//.test(s)
          ? 'Firefox'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'Unknown';

  const deviceType = /iPad|Tablet|(Android(?!.*Mobile))/.test(s)
    ? 'tablet'
    : /Mobile|iPhone|iPod|Android/.test(s)
      ? 'mobile'
      : 'desktop';

  const label = browser === 'Unknown' && os === 'Unknown' ? 'Unknown device' : `${browser} on ${os}`;
  return { browser, os, deviceType, label };
}

/** Map a refresh-token row → SessionDto for the UI. */
export function toSessionDto(
  row: { id: string; ip: string | null; userAgent: string | null; createdAt: Date; expiresAt: Date },
  currentSid?: string,
): SessionDto {
  const ip = normaliseIp(row.ip);
  const ua = parseUserAgent(row.userAgent);
  return {
    id: row.id,
    ip,
    location: describeLocation(ip),
    deviceType: ua.deviceType,
    deviceLabel: ua.label,
    browser: ua.browser,
    os: ua.os,
    current: !!currentSid && row.id === currentSid,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
