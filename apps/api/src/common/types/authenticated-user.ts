/** Shape attached to `request.user` after JWT authentication. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  /** Role machine names. */
  roles: string[];
  /** Flattened permission keys; contains '*' for super admins. */
  permissions: string[];
  /** Session id (the refresh-token row this access token was issued with). */
  sid?: string;
}
