/**
 * CRM Follow-ups (commitment tracking + "anti-forget" reminders).
 *
 * A follow-up is one promise made to a party ("deliver 10 MALBORO by Wednesday").
 * It carries a promised date, a timeline of status logs, and a reminder loop that
 * keeps surfacing it until it's resolved — you can *snooze* it, never *dismiss* it.
 */
import type { Paginated, PaginationQuery } from './common';

export const FOLLOWUP_KINDS = ['DELIVERY', 'PAYMENT'] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export const FOLLOWUP_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const FOLLOWUP_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export type FollowupPriority = (typeof FOLLOWUP_PRIORITIES)[number];

/** One entry in a follow-up's timeline. */
export const FOLLOWUP_LOG_KINDS = ['NOTE', 'ACK', 'SNOOZE', 'PROMISE', 'STATUS'] as const;
export type FollowupLogKind = (typeof FOLLOWUP_LOG_KINDS)[number];

export interface FollowupLogDto {
  id: number;
  followupId: number;
  kind: FollowupLogKind;
  note: string | null;
  stage: string | null;
  /** A re-promised date recorded by this log entry. */
  newPromisedAt: string | null;
  userName: string | null;
  createdAt: string;
}

/** A tick-off task on a follow-up. `source: 'VOICE'` only appears on rows
 *  created before the voice-input feature was removed — new items are always 'MANUAL'. */
export interface FollowupChecklistItemDto {
  id: number;
  followupId: number;
  text: string;
  done: boolean;
  sortOrder: number;
  source: 'MANUAL' | 'VOICE';
  createdAt: string;
}

export interface FollowupDto {
  id: number;
  kind: FollowupKind;
  customerId: number | null;
  /** Always set — a free-typed party name is allowed when the customer isn't in the system. */
  partyName: string;
  orderId: number | null;
  orderCode: string | null;
  orderItemId: number | null;
  /** Free-text item when there's no linked order line. */
  itemText: string | null;
  title: string;
  detail: string | null;
  /** Current stuck-stage, e.g. POLISHING / SUPPLIER / DISPATCH / READY (free text). */
  stage: string | null;
  priority: FollowupPriority;
  status: FollowupStatus;
  promisedAt: string | null;
  /** Per-follow-up reminder overrides (fall back to CRM defaults when null). */
  reminderIntervalMins: number | null;
  maxRemindersPerDay: number | null;
  remindersToday: number;
  nextRemindAt: string | null;
  lastRemindedAt: string | null;
  createdByName: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  logs?: FollowupLogDto[];
  checklist?: FollowupChecklistItemDto[];
}

/* ── Reminder-state engine (shared by the dashboard, board + nudge modal) ────── */

export type FollowupUrgency = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'NO_DATE' | 'RESOLVED';

export interface FollowupState {
  urgency: FollowupUrgency;
  /** Days until the promised date (negative = overdue); null when no date. */
  daysToPromise: number | null;
  /** The intrusive reminder should fire now (open, in-window, not snoozed, under the daily cap). */
  isActiveNudge: boolean;
  /** In the attention window (overdue / due today / within lead days) but maybe snoozed. */
  needsAttention: boolean;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Compute a follow-up's reminder state at `now`. Pure + deterministic so the
 * server, dashboard, board and the nudge modal all agree. `leadDays` starts the
 * attention window that many days before the promised date (so a Wednesday promise
 * flags on Tuesday when leadDays = 1).
 */
export function computeFollowupState(
  f: {
    status: string;
    promisedAt?: string | null;
    nextRemindAt?: string | null;
    remindersToday?: number | null;
    maxRemindersPerDay?: number | null;
  },
  now: Date = new Date(),
  leadDays = 1,
): FollowupState {
  if (f.status !== 'OPEN') {
    return { urgency: 'RESOLVED', daysToPromise: null, isActiveNudge: false, needsAttention: false };
  }

  let urgency: FollowupUrgency;
  let daysToPromise: number | null = null;
  if (f.promisedAt) {
    const promised = new Date(f.promisedAt);
    daysToPromise = Math.round((startOfDay(promised).getTime() - startOfDay(now).getTime()) / DAY);
    urgency = daysToPromise < 0 ? 'OVERDUE' : daysToPromise === 0 ? 'DUE_TODAY' : 'UPCOMING';
  } else {
    urgency = 'NO_DATE';
  }

  const inWindow =
    daysToPromise != null ? daysToPromise <= leadDays : !!f.nextRemindAt; // no date → only nudges if a reminder is set
  const snoozePassed = !f.nextRemindAt || new Date(f.nextRemindAt).getTime() <= now.getTime();
  const underCap = f.maxRemindersPerDay == null || (f.remindersToday ?? 0) < f.maxRemindersPerDay;

  return {
    urgency,
    daysToPromise,
    needsAttention: inWindow,
    isActiveNudge: inWindow && snoozePassed && underCap,
  };
}

/* ── Queries / inputs ────────────────────────────────────────────────────────── */

export type FollowupQuery = PaginationQuery & {
  kind?: string;
  status?: string;
  party?: string;
  /** 'attention' = overdue + due today + active nudges; 'overdue'; 'today'; 'upcoming'. */
  bucket?: string;
};
export type FollowupList = Paginated<FollowupDto>;

export interface FollowupSummary {
  overdue: number;
  dueToday: number;
  upcoming: number;
  activeNudges: number;
  openTotal: number;
}

/** A party group for the party-wise board. */
export interface FollowupPartyGroup {
  partyName: string;
  customerId: number | null;
  openCount: number;
  overdueCount: number;
  activeNudges: number;
  /** Soonest promised date among the party's open follow-ups. */
  nextPromiseAt: string | null;
  items: FollowupDto[];
}

export interface SaveFollowupInput {
  kind?: FollowupKind;
  customerId?: number | null;
  partyName: string;
  orderId?: number | null;
  orderCode?: string | null;
  orderItemId?: number | null;
  itemText?: string | null;
  title: string;
  detail?: string | null;
  stage?: string | null;
  priority?: FollowupPriority;
  promisedAt?: string | null;
  reminderIntervalMins?: number | null;
  maxRemindersPerDay?: number | null;
  /** Checklist tasks to create with the follow-up. */
  checklist?: { text: string; source?: 'MANUAL' | 'VOICE' }[];
}

export interface AddFollowupLogInput {
  note?: string | null;
  stage?: string | null;
  /** Optionally re-promise a new date with this log entry. */
  newPromisedAt?: string | null;
}

/** CRM reminder defaults (AppConfig key CRM_REMINDER_DEFAULTS). */
export interface CrmReminderSettings {
  /** Minutes between re-nudges of an unresolved follow-up. */
  intervalMins: number;
  /** Max times a single follow-up nudges in one day (0 = unlimited). */
  maxRemindersPerDay: number;
  /** How many days before the promised date the attention window opens. */
  leadDays: number;
  /** Working-hours window (24h, local) — reminders are clamped inside it. */
  workStartHour: number;
  workEndHour: number;
  /** Play a chime when a reminder fires. */
  sound: boolean;
  /** Send desktop browser notifications. */
  desktopNotifications: boolean;
}

export const DEFAULT_CRM_SETTINGS: CrmReminderSettings = {
  intervalMins: 120,
  maxRemindersPerDay: 0,
  leadDays: 1,
  workStartHour: 9,
  workEndHour: 20,
  sound: true,
  desktopNotifications: true,
};
