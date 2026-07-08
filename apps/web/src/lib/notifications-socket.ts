import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { TestNotificationPayload } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';
import { playTestChime } from './chime';

let socket: Socket | null = null;

/** Shows a native OS notification if permission was granted — the browser/OS controls its sound. */
function showNativeNotification(payload: TestNotificationPayload): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('OMS test notification', {
      body: `Triggered by ${payload.triggeredBy}`,
      icon: '/icons/icon-192.png',
    });
  } catch {
    /* ignore — some platforms restrict constructing Notification directly */
  }
}

/**
 * Opens one Socket.IO connection for this browser tab (idempotent — safe to
 * call more than once) and keeps it alive for as long as OMS is open here.
 * Reconnects automatically (socket.io-client default behaviour) after a
 * dropped connection, e.g. an API restart.
 */
export function connectNotificationsSocket(): void {
  if (socket) return;
  const token = useAuthStore.getState().accessToken;
  if (!token) return;

  socket = io('/', {
    path: '/socket.io',
    auth: { token },
  });

  socket.on('test-notification', (payload: TestNotificationPayload) => {
    showNativeNotification(payload);
    playTestChime();
    toast.info(`Test notification received (sent by ${payload.triggeredBy})`);
  });
}
