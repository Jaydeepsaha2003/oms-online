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
  iat?: number;
  exp?: number;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
