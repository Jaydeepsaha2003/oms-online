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

/** True if this browser has an active push subscription right now (used to render button state). */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return !!existing && Notification.permission === 'granted';
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

  const registration = await navigator.serviceWorker.ready;
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
