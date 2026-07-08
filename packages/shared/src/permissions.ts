/**
 * Permission model
 * ----------------
 * Access control is expressed as `resource:action` strings (e.g. `order:create`).
 * This file is the single catalog of every permission the system knows about.
 *
 * - The API seeds these into the `Permission` table and enforces them with the
 *   `@Permissions(...)` guard.
 * - The web app uses the same keys to show/hide menu entries, routes and buttons.
 *
 * To add access to a new feature: add the resource here, list the actions it
 * supports, and the catalog (used by the seed + role editor) updates itself.
 */

/** Actions a user can perform on a resource. */
export const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  IMPORT: 'import',
  APPROVE: 'approve',
  PRINT: 'print',
  /** Convert a quotation into an order. */
  CONVERT: 'convert',
  /** Cancel a quotation (with a tracked reason). */
  CANCEL: 'cancel',
  /** Full control of a resource — implies every other action on it. */
  MANAGE: 'manage',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Resources (feature areas) that can be protected. */
export const RESOURCES = {
  DASHBOARD: 'dashboard',
  ORDER: 'order',
  /** Bag bookings: provisional bags+kgs, rate frozen at booking date, convert-to-items later. */
  BOOKING: 'booking',
  QUOTATION: 'quotation',
  DISPATCH: 'dispatch',
  /** Challan / tax invoice (legacy PendChallan + Form14). */
  CHALLAN: 'challan',
  PRODUCT: 'product',
  DESIGN: 'design',
  DESIGN_NAME: 'designname',
  COMBINATION: 'combination',
  CUSTOMER: 'customer',
  AGENT: 'agent',
  TRANSPORTER: 'transporter',
  TRANS_RATE: 'transrate',
  GST_RATE: 'gstrate',
  /** Per-customer special rate overrides + logo restrictions (legacy Form10). */
  SPECIAL_RATE: 'specialrate',
  /** CRM: party follow-ups / commitment tracking + reminders. */
  CRM: 'crm',
  /** Accounts → Manage Cheques (legacy Cheque Management System). */
  CHEQUE: 'cheque',
  /** Company bank accounts master (legacy SETTING_BANK_NAME). */
  BANK_ACCOUNT: 'bankaccount',
  /** Accounts → Payment (receipt allocation subledger, legacy PaymentForm). */
  PAYMENT: 'payment',
  /** Accounts → Opening Balance (per-customer opening bank/cash, DR/CR). */
  OPENING_BALANCE: 'openingbalance',
  /** Accounts → Sales Discount (discount pending invoices, legacy SalesDiscount). */
  DISCOUNT: 'discount',
  /** Debit / Credit Note (legacy DebitNote form). DN posts a debit + squares off
   *  advances; CN posts a credit + clears opening/invoices FIFO then parks advance. */
  NOTE: 'note',
  /** Party Ledger / Trial Balance (legacy Party Ledger Account) — Tally-style
   *  per-party statement with opening, running Dr/Cr, aging KPIs & closing. */
  PARTY_LEDGER: 'partyledger',
  SUPPLIER: 'supplier',
  INVENTORY: 'inventory',
  PRODUCTION: 'production',
  BOM: 'bom',
  PURCHASE: 'purchase',
  INVOICE: 'invoice',
  SHIPMENT: 'shipment',
  REPORT: 'report',
  USER: 'user',
  ROLE: 'role',
  AUDIT_LOG: 'auditlog',
  SETTING: 'setting',
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

/** Build a permission key from a resource + action. */
export const perm = (resource: string, action: Action): string => `${resource}:${action}`;

/** The special key that grants everything (assigned to Super Admin). */
export const ALL_PERMISSIONS = '*';

/**
 * Convenience action sets reused by many resources. `MANAGE` is included so the
 * `<resource>:manage` wildcard (see {@link hasPermission}) is an assignable,
 * real permission — that's how roles grant "full control of this area".
 */
const READONLY: Action[] = [ACTIONS.VIEW, ACTIONS.EXPORT];
const STANDARD: Action[] = [
  ACTIONS.VIEW,
  ACTIONS.CREATE,
  ACTIONS.UPDATE,
  ACTIONS.DELETE,
  ACTIONS.EXPORT,
  ACTIONS.IMPORT,
  ACTIONS.MANAGE,
];
const STANDARD_PRINTABLE: Action[] = [...STANDARD, ACTIONS.PRINT, ACTIONS.APPROVE];

/** Definition of a resource and which actions are meaningful for it. */
export interface ResourceDef {
  resource: Resource;
  /** Human label shown in the role/permission editor. */
  label: string;
  /** Group heading used to organise the permission matrix. */
  group: string;
  actions: Action[];
}

export const RESOURCE_DEFINITIONS: ResourceDef[] = [
  { resource: RESOURCES.DASHBOARD, label: 'Dashboard', group: 'General', actions: [ACTIONS.VIEW] },

  { resource: RESOURCES.ORDER, label: 'Orders', group: 'Sales', actions: STANDARD_PRINTABLE },
  {
    resource: RESOURCES.BOOKING,
    label: 'Bag Bookings',
    group: 'Sales',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.CONVERT, ACTIONS.CANCEL, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.QUOTATION,
    label: 'Quotations',
    group: 'Sales',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.EXPORT, ACTIONS.CONVERT, ACTIONS.CANCEL, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.DISPATCH,
    label: 'Dispatch',
    group: 'Sales',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.EXPORT, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.CHALLAN,
    label: 'Challan / Invoices',
    group: 'Sales',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.PRINT, ACTIONS.MANAGE],
  },
  { resource: RESOURCES.CUSTOMER, label: 'Customers', group: 'Sales', actions: STANDARD },
  { resource: RESOURCES.AGENT, label: 'Agents', group: 'Sales', actions: STANDARD },
  { resource: RESOURCES.TRANSPORTER, label: 'Transporters', group: 'Sales', actions: STANDARD },
  { resource: RESOURCES.GST_RATE, label: 'Customer GST Rates', group: 'Sales', actions: STANDARD },
  { resource: RESOURCES.TRANS_RATE, label: 'Customer Transport Rates', group: 'Sales', actions: STANDARD },
  {
    resource: RESOURCES.SPECIAL_RATE,
    label: 'Customer Special Rates',
    group: 'Sales',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.CRM,
    label: 'CRM / Follow-ups',
    group: 'Sales',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  { resource: RESOURCES.INVOICE, label: 'Invoices', group: 'Sales', actions: STANDARD_PRINTABLE },

  {
    resource: RESOURCES.CHEQUE,
    label: 'Manage Cheques',
    group: 'Accounts',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.EXPORT, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.BANK_ACCOUNT,
    label: 'Bank Accounts',
    group: 'Accounts',
    actions: STANDARD,
  },
  {
    resource: RESOURCES.PAYMENT,
    label: 'Payment / Receipts',
    group: 'Accounts',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.DELETE, ACTIONS.EXPORT, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.OPENING_BALANCE,
    label: 'Opening Balance',
    group: 'Accounts',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.DISCOUNT,
    label: 'Sales Discount',
    group: 'Accounts',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.NOTE,
    label: 'Debit / Credit Note',
    group: 'Accounts',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.PRINT, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.PARTY_LEDGER,
    label: 'Party Ledger',
    group: 'Accounts',
    actions: [ACTIONS.VIEW, ACTIONS.EXPORT, ACTIONS.PRINT],
  },
  {
    resource: RESOURCES.SHIPMENT,
    label: 'Shipments',
    group: 'Sales',
    actions: [...STANDARD, ACTIONS.PRINT],
  },

  { resource: RESOURCES.PRODUCT, label: 'Products', group: 'Catalog', actions: STANDARD },
  { resource: RESOURCES.DESIGN, label: 'Designs', group: 'Catalog', actions: STANDARD },
  { resource: RESOURCES.DESIGN_NAME, label: 'Design Names', group: 'Catalog', actions: STANDARD },
  { resource: RESOURCES.COMBINATION, label: 'Combinations', group: 'Catalog', actions: STANDARD },
  { resource: RESOURCES.BOM, label: 'Bill of Materials', group: 'Catalog', actions: STANDARD },

  {
    resource: RESOURCES.PRODUCTION,
    label: 'Production / Work Orders',
    group: 'Production',
    actions: STANDARD_PRINTABLE,
  },

  {
    resource: RESOURCES.PURCHASE,
    label: 'Purchase Orders',
    group: 'Procurement',
    actions: STANDARD_PRINTABLE,
  },
  { resource: RESOURCES.SUPPLIER, label: 'Suppliers', group: 'Procurement', actions: STANDARD },

  { resource: RESOURCES.INVENTORY, label: 'Inventory / Stock', group: 'Inventory', actions: STANDARD },

  { resource: RESOURCES.REPORT, label: 'Reports', group: 'Reports', actions: READONLY },

  {
    resource: RESOURCES.USER,
    label: 'Users',
    group: 'Administration',
    actions: STANDARD,
  },
  {
    resource: RESOURCES.ROLE,
    label: 'Roles & Permissions',
    group: 'Administration',
    actions: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  {
    resource: RESOURCES.AUDIT_LOG,
    label: 'Audit Log',
    group: 'Administration',
    actions: [ACTIONS.VIEW, ACTIONS.EXPORT],
  },
  {
    resource: RESOURCES.SETTING,
    label: 'Settings',
    group: 'Administration',
    actions: [ACTIONS.VIEW, ACTIONS.UPDATE],
  },
];

/** A single concrete permission, used by the seed and the role editor UI. */
export interface PermissionDef {
  key: string;
  resource: Resource;
  action: Action;
  label: string;
  group: string;
}

/** Flattened catalog of every permission in the system (de-duplicated by key). */
export const PERMISSION_CATALOG: PermissionDef[] = (() => {
  const seen = new Set<string>();
  const out: PermissionDef[] = [];
  for (const def of RESOURCE_DEFINITIONS) {
    for (const action of def.actions) {
      const key = perm(def.resource, action);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, resource: def.resource, action, label: `${def.label}: ${action}`, group: def.group });
    }
  }
  return out;
})();

/** All permission keys as a flat array. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((p) => p.key);

/**
 * Does a set of granted permissions satisfy a required permission?
 * Honours two wildcards:
 *   - `*`              → super admin, grants everything
 *   - `<resource>:manage` → grants every action on that resource
 */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has(ALL_PERMISSIONS)) return true;
  if (set.has(required)) return true;
  const [resource] = required.split(':');
  return set.has(perm(resource, ACTIONS.MANAGE));
}

/** True if the granted set satisfies ANY of the required permissions. */
export function hasAnyPermission(granted: Iterable<string>, required: string[]): boolean {
  if (required.length === 0) return true;
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.some((r) => hasPermission(set, r));
}

/** True if the granted set satisfies ALL of the required permissions. */
export function hasAllPermissions(granted: Iterable<string>, required: string[]): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.every((r) => hasPermission(set, r));
}
