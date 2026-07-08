/** Broadcast to every connected device when Settings → "Send test notification" fires. */
export interface TestNotificationPayload {
  /** Display name of the user who triggered the test. */
  triggeredBy: string;
  /** ISO 8601 timestamp of when it was sent. */
  at: string;
}

/** Response body of `POST /notifications/test`. */
export interface TestNotificationResult {
  /** How many devices (open sockets) the broadcast reached, including the sender's own tab. */
  devicesNotified: number;
}
