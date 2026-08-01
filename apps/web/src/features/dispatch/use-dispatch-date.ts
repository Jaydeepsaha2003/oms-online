import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local-time YYYY-MM-DD (no timezone shift) — matches the app's date inputs. */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

interface Stored {
  /** The chosen dispatch date (may be a back-date). */
  date: string;
  /** The calendar day this choice was made on — the "sticky until" marker. */
  setOn: string;
}

const keyFor = (userId?: string) => `oms:dispatch-date:${userId ?? 'anon'}`;

function read(key: string, today: string): string {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return today;
    const parsed = JSON.parse(raw) as Stored;
    // A choice only sticks for the day it was made — a forgotten back-date from
    // yesterday can't silently keep applying today.
    return parsed.setOn === today ? parsed.date : today;
  } catch {
    return today;
  }
}

/**
 * The dispatch date shown at the top of the Dispatch Order page and sent as the
 * default `dispatchDate` for every dispatch created while it's in effect.
 *
 * Defaults to today. A manual change sticks for the rest of THAT calendar day —
 * every dispatch submitted reuses it — then resets to today on its own the next
 * time this loads on a new day. Per user (keyed to their id) and kept in
 * localStorage so a page refresh doesn't lose it mid-day.
 */
export function useDispatchDate() {
  const userId = useAuthStore((s) => s.user?.id);
  const key = keyFor(userId);
  const today = ymd(new Date());
  const [date, setDateState] = useState(() => read(key, today));

  // If the tab was left open across midnight, snap back to today as soon as it's
  // looked at again, instead of waiting for a reload to notice the day changed.
  useEffect(() => {
    const check = () => {
      const now = ymd(new Date());
      const next = read(key, now);
      setDateState((cur) => (cur === next ? cur : next));
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setDate = (next: string) => {
    setDateState(next);
    try {
      localStorage.setItem(key, JSON.stringify({ date: next, setOn: ymd(new Date()) } satisfies Stored));
    } catch {
      /* storage unavailable (private mode) — the choice just won't survive a refresh */
    }
  };

  return { date, setDate, isToday: date === today, resetToToday: () => setDate(today) };
}
