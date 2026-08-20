import type { PushSubscriptionRequest, VapidPublicKeyResult } from '@oms/shared';
import { http } from './api';

export type SubscribeResult = { ok: true } | { ok: false; reason: string };

const UNSUPPORTED_REASON =
  'This browser/app does not support push notifications. On iPhone, add OMS to your Home Screen first (needs iOS 16.4 or later).';

/** Converts a VAPID base64url public key into the Uint8Array pushManager.subscribe() needs. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * The active service-worker registration, or null — WITHOUT hanging.
 *
 * `navigator.serviceWorker.ready` never settles when no worker is registered,
 * and registration is allowed to fail silently (main.tsx swallows it — plain
 * HTTP over the LAN is the documented case). Anything that awaited `.ready` to
 * decide what to render therefore hung forever on exactly those devices and the
 * control never appeared. Time-boxed so a missing or stuck worker resolves to
 * "no registration" instead of a promise that never returns.
 */
async function currentRegistration(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // getRegistration() settles straight away (to undefined when there is none);
  // `.ready` is raced only to pick up a worker that is mid-activation.
  const settled = await Promise.race([
    navigator.serviceWorker.getRegistration().catch(() => undefined),
    navigator.serviceWorker.ready.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
  return settled ?? null;
}

/** True if this browser has an active push subscription right now (used to render button state). */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const registration = await currentRegistration();
  if (!registration) return false;
  const existing = await registration.pushManager.getSubscription().catch(() => null);
  return !!existing;
}

/** Requests permission, subscribes to push, and registers the subscription with the server. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: UNSUPPORTED_REASON };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notification permission was not granted.' };
  }

  // Same guard as above: never await a `.ready` that may never settle — report
  // it instead, so the button surfaces a reason rather than spinning forever.
  const registration = await currentRegistration(8000);
  if (!registration) {
    return {
      ok: false,
      reason:
        'Notifications need the app’s background service, which is not running on this device. Open OMS over its https:// address (not a plain http:// one), then reload and try again.',
    };
  }
  const { publicKey } = await http.get<VapidPublicKeyResult>('/notifications/vapid-public-key');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // TS's DOM lib types PushSubscriptionOptionsInit.applicationServerKey as
    // BufferSource<ArrayBuffer>; a plain Uint8Array's buffer type is the wider
    // ArrayBufferLike, so it needs an explicit cast even though it's valid at runtime.
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  if (!json.endpoint || !json.keys) {
    return { ok: false, reason: 'Push subscription is missing its endpoint or encryption keys.' };
  }

  const body: PushSubscriptionRequest = { endpoint: json.endpoint, keys: json.keys };
  await http.post('/notifications/push-subscribe', body);
  return { ok: true };
}
