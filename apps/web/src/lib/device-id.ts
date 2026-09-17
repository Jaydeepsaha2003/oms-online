/**
 * A stable identity for THIS browser, so a device stays one device.
 *
 * My devices was keyed on the parsed user-agent plus the IP address, which is
 * the only pair the server could see. Both are the wrong thing to identify a
 * device by:
 *
 *  - the user-agent is shared by every phone of that make ("Chrome on Android"),
 *    so two phones collapsed into one line; and
 *  - the IP moves. The app is reached over the LAN by address, and DHCP hands
 *    out a different one often enough that the SAME phone appeared as a new
 *    device every few days. That is what grew the list.
 *
 * A id minted here and kept in localStorage is neither: it survives an IP
 * change, it differs between two identical handsets, and it lets a name given
 * once follow the device into every later sign-in.
 *
 * It identifies a BROWSER, not a person — which is exactly the scope of "this
 * device" — and it is not a credential: it grants nothing on its own, and the
 * server only ever reads it alongside a real token.
 */
const KEY = 'oms.device-id';

let cached: string | null = null;

export function getDeviceId(): string | null {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return cached;
    }
    // `randomUUID` needs a secure context; the LAN is served over HTTPS, but a
    // plain-HTTP fallback exists (see vite.config) and must not throw here.
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // Private mode or storage blocked: no stable id to offer. The server falls
    // back to the old browser+IP guess, which is what it did for everyone
    // before this existed.
    return null;
  }
}
