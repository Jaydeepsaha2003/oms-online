import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { AppNotification, TestNotificationPayload } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';
import { queryClient } from './query';
import { playTestChime } from './chime';

let socket: Socket | null = null;

/** Shows a native OS notification if permission was granted — the browser/OS controls its sound. */
function showNativeNotification(payload: TestNotificationPayload): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('OMS test notification', {
      body: `Triggered by ${payload.triggeredBy}`,
      icon: '/icons/icon-192-v4.png',
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

  // Live refresh: another user created/edited/cancelled/deleted a challan, so the
  // un-challaned pool moved. Invalidates:
  //   ['challans','pending'] - the Pending Challan list (see use-challans.ts).
  //   ['challans','draft']   - the pool Create Challan builds its Add-line picker
  //     from (useChallanDraft, staleTime: Infinity so it never polls on its own).
  //     Without this, a party's Create Challan screen had no way to learn that
  //     someone ELSE dispatched another item for the same party while the screen
  //     was already open - Pending Challan updated live, Create Challan silently
  //     didn't, and the second dispatch just sat unmentioned until the first
  //     challan was saved. Safe to background-refetch while the form is open:
  //     the one-time init effect (initedRef) only ever seeds `rows` from the
  //     FIRST settled draft, so a later refetch just refreshes the Add-line pool
  //     (draft.items -> available -> options) - it can never overwrite anything
  //     the user has already typed or added.
  // Silent by design - no toast/sound; the Create Challan screen surfaces this
  // itself (see the "newly arrived" banner in challan-form-page.tsx).
  socket.on('challans:pending-changed', () => {
    void queryClient.invalidateQueries({ queryKey: ['challans', 'pending'] });
    void queryClient.invalidateQueries({ queryKey: ['challans', 'draft'] });
  });

  // Live refresh: another user's Dispatch line lock was acquired or released, so
  // the Pending Dispatch view (base key ['dispatch','pending'] — see
  // use-dispatch.ts) re-fetches at once and shows/clears "being dispatched by X"
  // without waiting for the 2s poll. Pending Challan shows the same lock on its
  // own rows (a line can be mid-dispatch and still sit un-challaned), so it
  // needs the same nudge. Silent by design — no toast/sound.
  socket.on('dispatch:lock-changed', () => {
    void queryClient.invalidateQueries({ queryKey: ['dispatch', 'pending'] });
    void queryClient.invalidateQueries({ queryKey: ['challans', 'pending'] });
  });

  // A notification addressed to this user specifically — currently dispatch
  // alerts. The gateway has ALWAYS emitted this event (notifyUsers), but nothing
  // listened for it here, so every targeted in-app notification was silently
  // dropped. Web Push covers the closed-app case separately.
  socket.on('notification', (n: AppNotification) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(n.title, { body: n.body, icon: '/icons/icon-192-v4.png' });
      } catch {
        /* ignore — some platforms restrict constructing Notification directly */
      }
    }
    playTestChime();
    toast.info(n.title, { description: n.body });
  });
}

/** Closes this tab's socket (used on logout) so a subsequent login opens a
 *  fresh one carrying the new token, rather than reusing one authenticated
 *  with the now-revoked token. */
export function disconnectNotificationsSocket(): void {
  socket?.disconnect();
  socket = null;
}
