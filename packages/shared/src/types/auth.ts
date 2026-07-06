/** Authentication & session shapes. */

export interface LoginDto {
  email: string;
  password: string;
}

/** Quick login with a numeric PIN (email scopes the PIN to one account). */
export interface PinLoginDto {
  email: string;
  pin: string;
}

/** Set or replace the current user's quick-login PIN. */
export interface SetPinDto {
  pin: string;
}

export interface AuthTokens {
  accessToken: string;
  /** TTL of the access token in seconds (so the client can schedule refresh). */
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * The authenticated user as the web app needs it: identity + the flattened,
 * wildcard-resolved set of permission keys used for UI gating.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[]; // role machine names
  permissions: string[]; // flattened permission keys ('*' for super admin)
}

/** Response of /auth/login and /auth/refresh. */
export interface AuthResult extends AuthTokens {
  user: AuthUser;
}

/** Decoded JWT access-token payload (kept small). */
export interface JwtPayload {
  /** subject = user id */
  sub: string;
  email: string;
  /** token version, bumped to invalidate all sessions of a user */
  tv: number;
  /** session id = the refresh-token row this access token was issued with;
   *  lets a single device be logged out remotely (guard rejects a revoked sid). */
  sid?: string;
  iat?: number;
  exp?: number;
}

/** A device/session the user is (or was) signed in from. */
export interface SessionDto {
  id: string;
  /** Login IP (normalised, ::ffff: stripped). */
  ip: string | null;
  /** Offline label: "This device" / "Local network" / "External network" / "Unknown". */
  location: string;
  /** 'mobile' | 'tablet' | 'desktop' | 'unknown'. */
  deviceType: string;
  /** e.g. "Chrome on Windows". */
  deviceLabel: string;
  browser: string;
  os: string;
  /** This session belongs to the request that asked (don't surprise-logout yourself). */
  current: boolean;
  createdAt: string;
  expiresAt: string;
}

export type SessionList = SessionDto[];

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
