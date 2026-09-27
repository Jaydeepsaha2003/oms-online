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
/**
 * The certificate problem, as the device itself reports it.
 *
 * `window.isSecureContext` cannot see it: an https page stays a "secure
 * context" after the person taps through the certificate warning. What Chrome
 * does refuse is the service worker ("An SSL certificate error occurred when
 * fetching the script"), and without a worker there is no push, so that refusal
 * is the signal. main.tsx reports it here; the certificate banner listens.
 */
let workerCertRefused = false;
export const WORKER_CERT_EVENT = 'oms:worker-cert-refused';
export function reportWorkerFailure(err: unknown): void {
  if (!(err instanceof Error) || !/SSL certificate/i.test(err.message)) return;
  workerCertRefused = true;
  window.dispatchEvent(new Event(WORKER_CERT_EVENT));
}
export const isWorkerCertRefused = () => workerCertRefused;

/** The OMS certificate as a plain download: Android 11+ installs a CA only from
 *  Settings, which needs the file in Downloads (see the servers' route). */
export const CERT_DOWNLOAD_URL = '/oms-rootCA.crt?download=1';
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
/** Where Android keeps "install a CA", which moves between makers — hence the search. */
export const ANDROID_CERT_STEPS =
  'open Settings and search “CA certificate” (usually Security → More security settings → Encryption & credentials → Install a certificate → CA certificate; on Samsung, Biometrics and security → Other security settings → Install from device storage → CA certificate), tap Install anyway and pick OMS-rootCA.crt from Downloads. Then close OMS completely and open it again.';

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
