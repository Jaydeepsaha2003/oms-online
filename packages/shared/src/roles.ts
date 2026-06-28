/**
 * System roles
 * ------------
 * These are the built-in roles the seed creates. Roles are also fully editable
 * at runtime from the Roles & Permissions screen — this is just the starting set.
 *
 * `permissions: '*'` means "all permissions" (super admin). Otherwise a role
 * lists explicit permission keys, or `<resource>:manage` to grant a whole area.
 */

import { ACTIONS, ALL_PERMISSIONS, perm, RESOURCES } from './permissions';

export interface SystemRoleDef {
  /** Stable machine name (unique). */
  name: string;
  label: string;
  description: string;
  /** `'*'` for everything, or an explicit list of permission keys. */
  permissions: '*' | string[];
  /** System roles cannot be deleted from the UI. */
  isSystem: boolean;
}

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    name: 'super_admin',
    label: 'Super Administrator',
    description: 'Unrestricted access to every feature, including user & role management.',
    permissions: ALL_PERMISSIONS,
    isSystem: true,
  },
  {
    name: 'admin',
    label: 'Administrator',
    description: 'Manages day-to-day operations and users, but not low-level system settings.',
    permissions: [
      perm(RESOURCES.DASHBOARD, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.MANAGE),
      perm(RESOURCES.QUOTATION, ACTIONS.MANAGE),
      perm(RESOURCES.DISPATCH, ACTIONS.MANAGE),
      perm(RESOURCES.CHALLAN, ACTIONS.MANAGE),
      perm(RESOURCES.CUSTOMER, ACTIONS.MANAGE),
      perm(RESOURCES.TRANSPORTER, ACTIONS.MANAGE),
      perm(RESOURCES.GST_RATE, ACTIONS.MANAGE),
      perm(RESOURCES.TRANS_RATE, ACTIONS.MANAGE),
      perm(RESOURCES.SPECIAL_RATE, ACTIONS.MANAGE),
      perm(RESOURCES.INVOICE, ACTIONS.MANAGE),
      perm(RESOURCES.SHIPMENT, ACTIONS.MANAGE),
      perm(RESOURCES.PRODUCT, ACTIONS.MANAGE),
      perm(RESOURCES.BOM, ACTIONS.MANAGE),
      perm(RESOURCES.PRODUCTION, ACTIONS.MANAGE),
      perm(RESOURCES.PURCHASE, ACTIONS.MANAGE),
      perm(RESOURCES.SUPPLIER, ACTIONS.MANAGE),
      perm(RESOURCES.INVENTORY, ACTIONS.MANAGE),
      perm(RESOURCES.REPORT, ACTIONS.VIEW),
      perm(RESOURCES.REPORT, ACTIONS.EXPORT),
      perm(RESOURCES.USER, ACTIONS.MANAGE),
      perm(RESOURCES.ROLE, ACTIONS.VIEW),
      perm(RESOURCES.AUDIT_LOG, ACTIONS.VIEW),
    ],
    isSystem: true,
  },
  {
    name: 'manager',
    label: 'Operations Manager',
    description: 'Oversees sales, production and procurement; can approve and print documents.',
    permissions: [
      perm(RESOURCES.DASHBOARD, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.MANAGE),
      perm(RESOURCES.QUOTATION, ACTIONS.MANAGE),
      perm(RESOURCES.DISPATCH, ACTIONS.MANAGE),
      perm(RESOURCES.CHALLAN, ACTIONS.MANAGE),
      perm(RESOURCES.CUSTOMER, ACTIONS.VIEW),
      perm(RESOURCES.CUSTOMER, ACTIONS.UPDATE),
      perm(RESOURCES.SPECIAL_RATE, ACTIONS.MANAGE),
      perm(RESOURCES.INVOICE, ACTIONS.MANAGE),
      perm(RESOURCES.SHIPMENT, ACTIONS.MANAGE),
      perm(RESOURCES.PRODUCT, ACTIONS.VIEW),
      perm(RESOURCES.BOM, ACTIONS.VIEW),
      perm(RESOURCES.PRODUCTION, ACTIONS.MANAGE),
      perm(RESOURCES.PURCHASE, ACTIONS.MANAGE),
      perm(RESOURCES.SUPPLIER, ACTIONS.VIEW),
      perm(RESOURCES.INVENTORY, ACTIONS.VIEW),
      perm(RESOURCES.INVENTORY, ACTIONS.UPDATE),
      perm(RESOURCES.REPORT, ACTIONS.VIEW),
      perm(RESOURCES.REPORT, ACTIONS.EXPORT),
    ],
    isSystem: true,
  },
  {
    name: 'operator',
    label: 'Operator',
    description: 'Shop-floor / data-entry user: creates and updates records, no deletions.',
    permissions: [
      perm(RESOURCES.DASHBOARD, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.CREATE),
      perm(RESOURCES.ORDER, ACTIONS.UPDATE),
      perm(RESOURCES.QUOTATION, ACTIONS.VIEW),
      perm(RESOURCES.QUOTATION, ACTIONS.CREATE),
      perm(RESOURCES.QUOTATION, ACTIONS.UPDATE),
      perm(RESOURCES.QUOTATION, ACTIONS.CONVERT),
      perm(RESOURCES.QUOTATION, ACTIONS.CANCEL),
      perm(RESOURCES.DISPATCH, ACTIONS.VIEW),
      perm(RESOURCES.DISPATCH, ACTIONS.CREATE),
      perm(RESOURCES.DISPATCH, ACTIONS.UPDATE),
      perm(RESOURCES.CHALLAN, ACTIONS.VIEW),
      perm(RESOURCES.CHALLAN, ACTIONS.CREATE),
      perm(RESOURCES.CHALLAN, ACTIONS.UPDATE),
      perm(RESOURCES.CHALLAN, ACTIONS.PRINT),
      perm(RESOURCES.PRODUCTION, ACTIONS.VIEW),
      perm(RESOURCES.PRODUCTION, ACTIONS.UPDATE),
      perm(RESOURCES.INVENTORY, ACTIONS.VIEW),
      perm(RESOURCES.INVENTORY, ACTIONS.UPDATE),
      perm(RESOURCES.PRODUCT, ACTIONS.VIEW),
    ],
    isSystem: true,
  },
  {
    name: 'viewer',
    label: 'Viewer',
    description: 'Read-only access plus the ability to export data to Excel.',
    permissions: [
      perm(RESOURCES.DASHBOARD, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.EXPORT),
      perm(RESOURCES.QUOTATION, ACTIONS.VIEW),
      perm(RESOURCES.QUOTATION, ACTIONS.EXPORT),
      perm(RESOURCES.CUSTOMER, ACTIONS.VIEW),
      perm(RESOURCES.PRODUCT, ACTIONS.VIEW),
      perm(RESOURCES.PRODUCTION, ACTIONS.VIEW),
      perm(RESOURCES.INVENTORY, ACTIONS.VIEW),
      perm(RESOURCES.REPORT, ACTIONS.VIEW),
      perm(RESOURCES.REPORT, ACTIONS.EXPORT),
    ],
    isSystem: true,
  },
];

/** Machine name of the role that always has every permission. */
export const SUPER_ADMIN_ROLE = 'super_admin';
