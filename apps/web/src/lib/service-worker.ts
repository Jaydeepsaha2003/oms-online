/**
 * Finding this page's service worker, without hanging and without giving up too
 * early.
 *
 * Both things that depend on the worker — enrolling for push, and raising a real
 * OS notification so the machine makes its OWN sound — were each asking for it
 * their own way, and both got it wrong in the same direction. Sharing one answer
 * keeps them honest with each other.
 */

/**
 * The active registration, or null.
 *
 * Two failure modes have to be avoided at once:
 *
 *  - `navigator.serviceWorker.ready` NEVER settles when nothing is registered,
 *    and registration is allowed to fail silently (main.tsx swallows it — plain
 *    HTTP over the LAN is the documented case). Awaiting it alone hangs for ever
 *    on exactly those devices.
 *
 *  - `getRegistration()` settles at once, but to `undefined` while a worker is
 *    still registering. main.tsx registers on window 'load', which on a phone
 *    routinely lands after a caller has already asked — so treating that
 *    `undefined` as the answer reports "no worker" on a device that has one a
 *    moment later. That is what told a phone it had never enabled notifications,
 *    and what sent the OS-notification path down its Android-hostile fallback.
 *
 * So: believe `getRegistration()` when it finds something, and only then fall
 * back to waiting for `.ready` — bounded, so a device with genuinely no worker
 * resolves to null rather than never resolving at all.
 */
export async function currentRegistration(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (existing) return existing;

  const settled = await Promise.race([
    navigator.serviceWorker.ready.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
  return settled ?? null;
}
