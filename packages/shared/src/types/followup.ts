/**
 * CRM Follow-ups (commitment tracking + "anti-forget" reminders).
 *
 * A follow-up is one promise made to a party ("deliver 10 MALBORO by Wednesday").
 * It carries a promised date, a timeline of status logs, and a reminder loop that
 * keeps surfacing it until it's resolved — you can *snooze* it, never *dismiss* it.
 */
import type { Paginated, PaginationQuery } from './common';
import type { PromiseState } from './report';

/**
 * DELIVERY — a promise about goods. PAYMENT — a promise about money.
 * INQUIRY — a new enquiry from a party that has not become an order yet.
 *
 * Inquiries deliberately reuse the follow-up machinery rather than getting their
 * own model: an enquiry IS a thing you must chase, with a party, a promised
 * date, a reminder loop and a timeline — all of which already exist here.
 */
export const FOLLOWUP_KINDS = ['DELIVERY', 'PAYMENT', 'INQUIRY'] as const;
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

/** One item (with quantities) covered by a follow-up — a follow-up can span
 *  several order lines, each with its own bags/pcs/kgs/box. */
export interface FollowupItemDto {
  id: number;
  followupId: number;
  orderItemId: number | null;
  orderCode: string | null;
  productName: string | null;
  bags: number | null;
  pcs: number | null;
  kgs: number | null;
  box: number | null;
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
  /** The agent this commitment was made by, when the promise came from an agent
   *  rather than the party ("he'll arrange an RTGS instead of the cheque"). */
  agentId: number | null;
  agentName: string | null;
  /** The cheque the conversation was about, so the promise stays attached to it. */
  chequeId: number | null;
  chequeNo: string | null;
  title: string;
  detail: string | null;
  /** Current stuck-stage, e.g. POLISHING / SUPPLIER / DISPATCH / READY (free text). */
  stage: string | null;
  priority: FollowupPriority;
  status: FollowupStatus;
  promisedAt: string | null;
  /** Promise-to-pay amount (₹) for PAYMENT follow-ups. */
  promisedAmount: number | null;
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
  items?: FollowupItemDto[];
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
  agentId?: number;
  chequeId?: number;
  /** Only commitments an agent made, whichever agent that is (§8). */
  agentOnly?: boolean;
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
  /** §8 — the agent who made this commitment, and the cheque it was about. */
  agentId?: number | null;
  agentName?: string | null;
  chequeId?: number | null;
  title: string;
  detail?: string | null;
  stage?: string | null;
  priority?: FollowupPriority;
  promisedAt?: string | null;
  /** Promise-to-pay amount (₹) — for PAYMENT follow-ups. */
  promisedAmount?: number | null;
  reminderIntervalMins?: number | null;
  maxRemindersPerDay?: number | null;
  /** Checklist tasks to create with the follow-up. */
  checklist?: { text: string; source?: 'MANUAL' | 'VOICE' }[];
  /** Item lines (each with optional quantities) covered by this follow-up. When
   *  provided on update, they REPLACE the existing set. */
  items?: FollowupItemInput[];
}

export interface FollowupItemInput {
  orderItemId?: number | null;
  orderCode?: string | null;
  productName?: string | null;
  bags?: number | null;
  pcs?: number | null;
  kgs?: number | null;
  box?: number | null;
}

export interface AddFollowupLogInput {
  note?: string | null;
  stage?: string | null;
  /** Optionally re-promise a new date with this log entry. */
  newPromisedAt?: string | null;
  /** Optionally record a new promise-to-pay amount (₹) with this re-promise. */
  newPromisedAmount?: number | null;
}

/* ── Party payment balances (Recovery Desk) ──────────────────────────────────── */

/** One still-open sales invoice contributing to a party's balance. */
export interface PartyOpenInvoice {
  /** Human invoice number (Challan.code). */
  code: string;
  invDate: string;
  dueDate: string | null;
  total: number;
  received: number;
  balance: number;
  /** Days past the due date (0 when not yet overdue / no due date). */
  overdueDays: number;
}

/** A party's live payment balance at a glance — the money a collector needs
 *  before starting a payment follow-up. Balances are all-time (an open invoice
 *  is open regardless of any date window). */
export interface PartyBalanceSummary {
  customerId: number | null;
  partyName: string;
  agent: string | null;
  /** Net receivable = billed − received, floored at 0, across open invoices. */
  outstanding: number;
  /** Portion of outstanding that is past its due date. */
  overdue: number;
  /** Portion due within the next 15 days. */
  dueSoon: number;
  /** Age (days) of the oldest overdue invoice; 0 when nothing is overdue. */
  oldestDays: number;
  /** Count of open (part-paid or unpaid) invoices. */
  invoiceCount: number;
  /** Most recent receipt date for this party. */
  lastReceiptAt: string | null;
  /** Unapplied advance money held for this party. */
  advanceHeld: number;
  // ── CRM overlay (from this party's PAYMENT follow-ups) ──
  openFollowups: number;
  nextPromiseAt: string | null;
  nextPromiseAmount: number | null;
  promiseState: PromiseState;
  /** Whether the party has any PAYMENT follow-up at all (open or done). */
  hasFollowup: boolean;
}

/** A party balance with its open-invoice breakdown (form drill-down). */
export interface PartyBalanceDetail extends PartyBalanceSummary {
  invoices: PartyOpenInvoice[];
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
