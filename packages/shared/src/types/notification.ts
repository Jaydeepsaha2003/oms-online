/** Broadcast to every connected device when Settings → "Send test notification" fires. */
export interface TestNotificationPayload {
  /** Display name of the user who triggered the test. */
  triggeredBy: string;
  /** ISO 8601 timestamp of when it was sent. */
  at: string;
}

/** Response body of `POST /notifications/test`. */
export interface TestNotificationResult {
  /** How many devices had an open WebSocket connection (existing path). */
  devicesNotified: number;
  /** How many stored push subscriptions a send was attempted against (new — reaches closed apps). */
  pushDevicesNotified: number;
}

/** The two encryption keys every Web Push subscription carries. */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** Body of `POST /notifications/push-subscribe` — the browser's PushSubscription, JSON-shaped. */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

/** Response body of `GET /notifications/vapid-public-key`. */
export interface VapidPublicKeyResult {
  publicKey: string;
}
