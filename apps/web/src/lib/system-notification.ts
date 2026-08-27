/**
 * Raising a real OS notification — the thing that makes the machine's OWN
 * notification sound, the same one every other app on it uses.
 *
 * A page cannot play that sound directly. There is no API for "the system
 * notification tone": it belongs to the OS, and the only way to trigger it is
 * to hand the OS an actual notification and let it sound off. Anything a page
 * synthesises or ships as an audio file is, by definition, a sound of our
 * choosing rather than the user's.
 */

/**
 * Show one notification. Returns whether it was actually shown, so the caller
 * knows whether it still has to make a noise of its own.
 *
 * Two APIs, and they are NOT interchangeable. Chrome on Android refuses
 * `new Notification()` outright — it throws "Illegal constructor" and accepts
 * notifications only through the service-worker registration. Desktop browsers
 * take either. So the worker is tried first and the constructor is the fallback,
 * which is the order that works on the most platforms.
 */
export async function showSystemNotification(
  title: string,
  options: NotificationOptions & { tag: string },
): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;

  // `silent: false` is already the default; it is spelled out because the sound
  // is the entire point of routing through the OS here.
  const opts: NotificationOptions = { silent: false, ...options };

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, opts);
      return true;
    }
  } catch {
    /* no worker, or it refused — try the page-level constructor below */
  }

  try {
    new Notification(title, opts);
    return true;
  } catch {
    return false; // iOS Safari and friends: no page-level notifications at all
  }
}

/** Show several, and report whether ANY of them made it. */
export async function showSystemNotifications(
  items: { title: string; options: NotificationOptions & { tag: string } }[],
): Promise<boolean> {
  const results = await Promise.all(items.map((n) => showSystemNotification(n.title, n.options)));
  return results.some(Boolean);
}
