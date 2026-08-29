/**
 * Dynamic menu registry
 * ----------------------
 * One declarative tree describes the whole application navigation. Each node can
 * require a permission; the menu the user actually sees is computed by filtering
 * this tree against their granted permissions (nopCommerce-style dynamic menu).
 *
 * - `icon` is a lucide-react icon name; the web app maps the string to a component.
 * - A leaf node has `to` (a route). A group node has `children`.
 * - A node is visible when the user satisfies its permission requirement; a group
 *   is visible when at least one of its children is visible.
 *
 * Add a screen later → add a node here with the right `permission`, and it shows
 * up in the sidebar, respects access control, and needs no other wiring.
 */

import { ACTIONS, hasAnyPermission, perm, RESOURCES } from './permissions';

export interface MenuNode {
  /** Stable unique id. */
  id: string;
  label: string;
  /** lucide-react icon name (e.g. 'ShoppingCart'). Groups/top-level items use it. */
  icon?: string;
  /** Route path for a leaf node. */
  to?: string;
  /** Single permission required to see this node. */
  permission?: string;
  /** Visible if the user has ANY of these permissions (alternative to `permission`). */
  anyPermission?: string[];
  /** Child nodes for a group. */
  children?: MenuNode[];
  /** Optional badge text (e.g. a count) the UI may render. */
  badge?: string;
  /** Alt+Shift+<letter> quick-nav key for a top-level entry (e.g. 'O' → Alt+Shift+O).
   *  A group jumps to its first accessible child; a leaf to its own route. */
  shortcut?: string;
}

// Built fresh — we add nodes here one screen at a time as each page is built.
export const MENU: MenuNode[] = [
  {
    id: 'dashboard',
    shortcut: 'D',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    to: '/',
    permission: perm(RESOURCES.DASHBOARD, ACTIONS.VIEW),
  },
  {
    id: 'reports-group',
    label: 'Reports',
    icon: 'BarChart3',
    permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
    children: [
      {
        id: 'report-overview',
        shortcut: 'R',
        label: 'Business Overview',
        to: '/reports/overview',
        icon: 'LayoutDashboard',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-summary-analysis',
        label: 'Summary Analysis',
        to: '/reports/summary',
        icon: 'Lightbulb',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-sales',
        label: 'Sales & Revenue',
        to: '/reports/sales',
        icon: 'TrendingUp',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-collections',
        label: 'Collections & Recovery',
        to: '/reports/collections',
        icon: 'HandCoins',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-parties',
        label: 'Party Intelligence',
        to: '/reports/parties',
        icon: 'Users',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-products',
        label: 'Product & Design',
        to: '/reports/products',
        icon: 'Package',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-patterns',
        label: 'Patterns & Insights',
        to: '/reports/patterns',
        icon: 'Sparkles',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-fulfilment',
        label: 'Orders & Fulfilment',
        to: '/reports/fulfilment',
        icon: 'Boxes',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
      {
        id: 'report-order-journey',
        label: 'Order Journey',
        to: '/reports/order-journey',
        icon: 'Route',
        permission: perm(RESOURCES.REPORT, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'customers-group',
    label: 'Customers',
    icon: 'Users',
    children: [
      {
        id: 'customers',
        shortcut: 'C',
        label: 'Customers',
        to: '/customers',
        icon: 'Contact',
        permission: perm(RESOURCES.CUSTOMER, ACTIONS.VIEW),
      },
      {
        id: 'transporters',
        label: 'Transporters',
        to: '/transporters',
        icon: 'Truck',
        permission: perm(RESOURCES.TRANSPORTER, ACTIONS.VIEW),
      },
      {
        id: 'gst-rates',
        label: 'GST Rates',
        to: '/gst-rates',
        icon: 'Percent',
        permission: perm(RESOURCES.GST_RATE, ACTIONS.VIEW),
      },
      {
        id: 'transport-rates',
        label: 'Transport Rates',
        to: '/transport-rates',
        icon: 'Receipt',
        permission: perm(RESOURCES.TRANS_RATE, ACTIONS.VIEW),
      },
      {
        id: 'special-rates',
        label: 'Special Rates',
        to: '/special-rates',
        icon: 'BadgePercent',
        permission: perm(RESOURCES.SPECIAL_RATE, ACTIONS.VIEW),
      },
      {
        id: 'rate-list',
        label: 'Rate List',
        to: '/customers/rate-list',
        icon: 'IndianRupee',
        permission: perm(RESOURCES.CUSTOMER, ACTIONS.VIEW),
      },
    ],
  },
  {
    /**
     * Everything about an agent in one place.
     *
     * These four screens were scattered: Agents sat among the Customers
     * masters, while Settlement, Commission Rates and Covers sat in Account
     * between Party Ledger and Daybook. Answering "what do we owe this agent,
     * and on what rates?" meant crossing two sections, and the rate master —
     * the thing every settlement is priced from — was the easiest of them to
     * miss entirely.
     *
     * MOVED, not copied. Two menu entries pointing at one route would leave the
     * sidebar unable to say which of them owns the URL, so each screen appears
     * exactly once. The routes themselves are unchanged, so existing bookmarks
     * and links still work.
     */
    id: 'agent-group',
    label: 'Agent',
    icon: 'Handshake',
    anyPermission: [
      perm(RESOURCES.AGENT, ACTIONS.VIEW),
      perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEW),
      perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEWRATES),
    ],
    children: [
      {
        id: 'agents',
        label: 'Agents',
        to: '/agents',
        icon: 'UserCog',
        permission: perm(RESOURCES.AGENT, ACTIONS.VIEW),
      },
      {
        id: 'agent-settlement',
        label: 'Agent Settlement',
        to: '/account/agent-settlement',
        icon: 'BadgeIndianRupee',
        permission: perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEW),
      },
      {
        // The rate master is money, so it needs `viewrates`, not plain view —
        // which is why it can be the only entry an accounts user sees here.
        id: 'commission-rates',
        label: 'Commission Rates',
        to: '/account/commission-rates',
        icon: 'Percent',
        permission: perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEWRATES),
      },
      {
        // Where a saved DRAFT is paid or cancelled. Without it "Save as draft"
        // was a one-way door: the draft held its invoices' claimable share and
        // there was no screen that could act on it.
        id: 'settlement-history',
        label: 'Settlement History',
        to: '/account/agent-settlement-history',
        icon: 'ScrollText',
        permission: perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEW),
      },
      {
        // The whole book, including the rows Settlement filters out — which are
        // exactly the rows an agent disputing his statement asks about.
        id: 'commission-ledger',
        label: 'Commission Ledger',
        to: '/account/commission-ledger',
        icon: 'BookOpen',
        permission: perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEW),
      },
      {
        id: 'agent-covers',
        label: 'Agent Covers',
        to: '/account/agent-covers',
        icon: 'HandCoins',
        permission: perm(RESOURCES.AGENT_COMMISSION, ACTIONS.VIEW),
      },
      // Cheque bounces and cheque timing are deliberately NOT entries here:
      // both are tabs/panels inside Manage Cheques, beside the cheques they
      // happen to. A bounce is only meaningful next to its cheque.
    ],
  },
  {
    id: 'products-group',
    label: 'Products',
    icon: 'Package',
    children: [
      {
        id: 'products',
        shortcut: 'P',
        label: 'Products',
        to: '/products',
        icon: 'Box',
        permission: perm(RESOURCES.PRODUCT, ACTIONS.VIEW),
      },
      {
        // The photos hang off order lines, so an order viewer can reach this
        // too: same rows they already see one line at a time in Order Modify,
        // grouped by party and by item instead.
        id: 'product-photos',
        label: 'Product Photos',
        to: '/products/photos',
        icon: 'Images',
        anyPermission: [perm(RESOURCES.PRODUCT, ACTIONS.VIEW), perm(RESOURCES.ORDER, ACTIONS.VIEW)],
      },
      {
        id: 'designs',
        label: 'Designs',
        to: '/designs',
        icon: 'ShoppingBag',
        permission: perm(RESOURCES.DESIGN, ACTIONS.VIEW),
      },
      {
        id: 'design-names',
        label: 'Design Names',
        to: '/design-names',
        icon: 'ListTree',
        permission: perm(RESOURCES.DESIGN_NAME, ACTIONS.VIEW),
      },
      {
        id: 'price-history',
        label: 'Price History',
        to: '/price-history',
        icon: 'History',
        permission: perm(RESOURCES.BOOKING, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'orders-group',
    label: 'Orders',
    icon: 'ShoppingCart',
    anyPermission: [
      perm(RESOURCES.ORDER, ACTIONS.VIEW),
      perm(RESOURCES.ORDER, ACTIONS.CREATE),
      perm(RESOURCES.QUOTATION, ACTIONS.VIEW),
      perm(RESOURCES.BOOKING, ACTIONS.VIEW),
    ],
    children: [
      {
        id: 'new-order',
        shortcut: 'O',
        label: 'New Order',
        to: '/orders/new',
        icon: 'ReceiptText',
        permission: perm(RESOURCES.ORDER, ACTIONS.CREATE),
      },
      {
        id: 'view-orders',
        label: 'View Orders',
        to: '/orders',
        icon: 'ListChecks',
        permission: perm(RESOURCES.ORDER, ACTIONS.VIEW),
      },
      {
        id: 'bag-bookings',
        label: 'Bag Bookings',
        to: '/bookings',
        icon: 'PackageOpen',
        permission: perm(RESOURCES.BOOKING, ACTIONS.VIEW),
      },
      {
        id: 'order-modify',
        label: 'Order Modify',
        to: '/orders/modify',
        icon: 'ClipboardList',
        permission: perm(RESOURCES.ORDER, ACTIONS.UPDATE),
      },
      {
        id: 'view-quotations',
        label: 'View Quotations',
        to: '/quotations',
        icon: 'FileText',
        permission: perm(RESOURCES.QUOTATION, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'dispatch-group',
    label: 'Dispatch',
    icon: 'Truck',
    anyPermission: [
      perm(RESOURCES.DISPATCH, ACTIONS.VIEW),
      perm(RESOURCES.DISPATCH, ACTIONS.CREATE),
      // Otherwise a role granted only Design Track would see no Dispatch group
      // at all, and so no way to reach the page it can actually open.
      perm(RESOURCES.DESIGN_TRACK, ACTIONS.VIEW),
    ],
    children: [
      {
        id: 'dispatch-order',
        shortcut: 'S',
        label: 'Dispatch Order',
        to: '/dispatch/new',
        icon: 'PackagePlus',
        permission: perm(RESOURCES.DISPATCH, ACTIONS.CREATE),
      },
      {
        id: 'modify-dispatch',
        label: 'Modify Dispatch',
        to: '/dispatch',
        icon: 'PackageCheck',
        permission: perm(RESOURCES.DISPATCH, ACTIONS.VIEW),
      },
      {
        id: 'design-track',
        label: 'Design Track',
        to: '/dispatch/design-track',
        icon: 'Sparkles',
        permission: perm(RESOURCES.DESIGN_TRACK, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'challan-group',
    label: 'Challan',
    icon: 'ScrollText',
    anyPermission: [perm(RESOURCES.CHALLAN, ACTIONS.VIEW), perm(RESOURCES.CHALLAN, ACTIONS.CREATE)],
    children: [
      {
        id: 'pending-challan',
        shortcut: 'L',
        label: 'Pending Challan',
        to: '/challans/pending',
        icon: 'ClipboardList',
        permission: perm(RESOURCES.CHALLAN, ACTIONS.CREATE),
      },
      {
        id: 'create-challan',
        label: 'Create Challan',
        to: '/challans/new',
        icon: 'FilePlus',
        permission: perm(RESOURCES.CHALLAN, ACTIONS.CREATE),
      },
      {
        id: 'challans',
        label: 'Challans',
        to: '/challans',
        icon: 'ScrollText',
        permission: perm(RESOURCES.CHALLAN, ACTIONS.VIEW),
      },
      {
        id: 'challan-items',
        label: 'Item-wise',
        to: '/challans/items',
        icon: 'Boxes',
        permission: perm(RESOURCES.CHALLAN, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'crm-group',
    label: 'CRM',
    icon: 'BellRing',
    anyPermission: [perm(RESOURCES.CRM, ACTIONS.VIEW), perm(RESOURCES.CRM, ACTIONS.CREATE)],
    children: [
      {
        id: 'crm-followups',
        shortcut: 'M',
        label: 'Follow-ups',
        to: '/crm',
        icon: 'CalendarClock',
        permission: perm(RESOURCES.CRM, ACTIONS.VIEW),
      },
      {
        id: 'crm-payments',
        label: 'Payments',
        to: '/crm/payments',
        icon: 'Wallet',
        permission: perm(RESOURCES.CRM, ACTIONS.VIEW),
      },
      {
        id: 'crm-inquiries',
        label: 'New Inquiries',
        to: '/crm/inquiries',
        icon: 'MessageSquarePlus',
        permission: perm(RESOURCES.CRM, ACTIONS.VIEW),
      },
      {
        id: 'crm-party-lists',
        label: 'Party Lists',
        to: '/crm/party-lists',
        icon: 'Tag',
        permission: perm(RESOURCES.CRM, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'account-group',
    label: 'Account',
    icon: 'Landmark',
    anyPermission: [
      perm(RESOURCES.PAYMENT, ACTIONS.VIEW),
      perm(RESOURCES.DISCOUNT, ACTIONS.VIEW),
      perm(RESOURCES.NOTE, ACTIONS.VIEW),
      perm(RESOURCES.PARTY_LEDGER, ACTIONS.VIEW),
      perm(RESOURCES.CHEQUE, ACTIONS.VIEW),
      perm(RESOURCES.OPENING_BALANCE, ACTIONS.VIEW),
      perm(RESOURCES.BANK_ACCOUNT, ACTIONS.VIEW),
      perm(RESOURCES.DAYBOOK, ACTIONS.VIEW),
    ],
    children: [
      {
        id: 'payment',
        shortcut: 'A',
        label: 'Receive Payment',
        to: '/account/payment',
        icon: 'HandCoins',
        permission: perm(RESOURCES.PAYMENT, ACTIONS.VIEW),
      },
      {
        id: 'party-advances',
        label: 'Party Advances',
        to: '/account/advances',
        icon: 'Wallet',
        permission: perm(RESOURCES.PAYMENT, ACTIONS.VIEW),
      },
      {
        id: 'sales-discount',
        label: 'Sales Discount',
        to: '/account/discount',
        icon: 'BadgePercent',
        permission: perm(RESOURCES.DISCOUNT, ACTIONS.VIEW),
      },
      {
        id: 'debit-credit-note',
        label: 'Debit / Credit Note',
        to: '/account/notes',
        icon: 'NotebookPen',
        permission: perm(RESOURCES.NOTE, ACTIONS.VIEW),
      },
      {
        id: 'party-ledger',
        label: 'Party Ledger',
        to: '/account/party-ledger',
        icon: 'BookText',
        permission: perm(RESOURCES.PARTY_LEDGER, ACTIONS.VIEW),
      },
      {
        id: 'daybook',
        label: 'Daybook',
        to: '/account/daybook',
        icon: 'BookOpenCheck',
        permission: perm(RESOURCES.DAYBOOK, ACTIONS.VIEW),
      },
      {
        id: 'tally-recon',
        label: 'Tally Reconciliation',
        to: '/account/tally-recon',
        icon: 'GitCompareArrows',
        permission: perm(RESOURCES.TALLY_RECON, ACTIONS.VIEW),
      },
      {
        id: 'bank-statement',
        label: 'Bank Statement Recon',
        to: '/account/bank-statement',
        icon: 'Landmark',
        permission: perm(RESOURCES.BANK_STATEMENT, ACTIONS.VIEW),
      },
      {
        id: 'manage-cheques',
        label: 'Manage Cheques',
        to: '/account/cheques',
        icon: 'ReceiptIndianRupee',
        permission: perm(RESOURCES.CHEQUE, ACTIONS.VIEW),
      },
      {
        id: 'opening-balance',
        label: 'Opening Balance',
        to: '/account/opening-balance',
        icon: 'BookOpen',
        permission: perm(RESOURCES.OPENING_BALANCE, ACTIONS.VIEW),
      },
      {
        id: 'bank-accounts',
        label: 'Bank Accounts',
        to: '/account/bank-accounts',
        icon: 'Landmark',
        permission: perm(RESOURCES.BANK_ACCOUNT, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    icon: 'ShieldCheck',
    anyPermission: [
      perm(RESOURCES.USER, ACTIONS.VIEW),
      perm(RESOURCES.ROLE, ACTIONS.VIEW),
      perm(RESOURCES.AUDIT_LOG, ACTIONS.VIEW),
      perm(RESOURCES.APPROVAL, ACTIONS.VIEW),
    ],
    children: [
      {
        id: 'users',
        shortcut: 'N',
        label: 'Users',
        to: '/admin/users',
        icon: 'Users',
        permission: perm(RESOURCES.USER, ACTIONS.VIEW),
      },
      {
        id: 'roles',
        label: 'Roles & Permissions',
        to: '/admin/roles',
        icon: 'KeyRound',
        permission: perm(RESOURCES.ROLE, ACTIONS.VIEW),
      },
      {
        id: 'approvals',
        label: 'Approvals',
        to: '/approvals',
        icon: 'ListChecks',
        permission: perm(RESOURCES.APPROVAL, ACTIONS.VIEW),
      },
      {
        id: 'audit-log',
        label: 'Activity Log',
        to: '/audit-logs',
        icon: 'History',
        permission: perm(RESOURCES.AUDIT_LOG, ACTIONS.VIEW),
      },
    ],
  },
  {
    id: 'settings',
    shortcut: 'G',
    label: 'Settings',
    to: '/settings',
    icon: 'Settings',
    permission: perm(RESOURCES.SETTING, ACTIONS.VIEW),
  },
];

/* ── Menu-shaped view of the permission catalog (Roles & Permissions editor) ──
 *
 * The role editor used to list RESOURCES — one "Dispatch" row covering both
 * Dispatch Order and Modify Dispatch. Admins don't think in resources; they think
 * "who can open Modify Dispatch?". These rows re-key the same permissions by the
 * screen they unlock, so the matrix reads like the sidebar.
 *
 * Nothing about the permission model changes — `openPermission` is the exact key
 * the sidebar already filters on. Which means two screens gated by the SAME key
 * (e.g. Pending Challan and Create Challan are both `challan:create`) cannot be
 * granted apart, and say so via `sharedWith` rather than pretending otherwise.
 */
export interface MenuPermissionRow {
  /** Menu group heading, e.g. 'Dispatch'. Top-level leaves use their own label. */
  group: string;
  /** The screen, e.g. 'Modify Dispatch'. */
  label: string;
  /** Menu node id — stable key for the UI. */
  id: string;
  /** Resource behind the screen, e.g. 'dispatch'. */
  resource: string;
  /** The permission that opens this screen (its sidebar/route gate). */
  openPermission: string;
  /** Other screens gated by the exact same permission — they move together. */
  sharedWith: string[];
}

/**
 * Every menu and sub-menu as a permission row, in sidebar order.
 *
 * A group node contributes only through its children (its own `anyPermission` is
 * derived from them, so granting it separately would mean nothing). Nodes with no
 * permission at all are skipped — there is nothing to grant.
 */
export function menuPermissionRows(menu: MenuNode[] = MENU): MenuPermissionRow[] {
  const rows: Omit<MenuPermissionRow, 'sharedWith'>[] = [];

  const walk = (nodes: MenuNode[], group: string | null) => {
    for (const node of nodes) {
      if (node.children?.length) {
        walk(node.children, node.label);
        continue;
      }
      // Leaves gate on a single `permission`; `anyPermission` is a group idiom.
      if (!node.permission) continue;
      const [resource] = node.permission.split(':');
      rows.push({ group: group ?? node.label, label: node.label, id: node.id, resource, openPermission: node.permission });
    }
  };
  walk(menu, null);

  const byPermission = new Map<string, string[]>();
  for (const r of rows) byPermission.set(r.openPermission, [...(byPermission.get(r.openPermission) ?? []), r.label]);

  return rows.map((r) => ({
    ...r,
    sharedWith: (byPermission.get(r.openPermission) ?? []).filter((l) => l !== r.label),
  }));
}

/** Returns the permission(s) a node requires, as an array (possibly empty). */
function requiredPermissions(node: MenuNode): string[] {
  if (node.anyPermission && node.anyPermission.length) return node.anyPermission;
  if (node.permission) return [node.permission];
  return [];
}

/**
 * Filter the menu tree down to what the given permission set is allowed to see.
 * Groups with no visible children are dropped.
 *
 * @param granted  the user's granted permission keys (Set or array)
 * @param menu     the menu tree (defaults to the global MENU)
 */
export function filterMenu(granted: Iterable<string>, menu: MenuNode[] = MENU): MenuNode[] {
  const set = granted instanceof Set ? granted : new Set(granted);

  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.reduce<MenuNode[]>((acc, node) => {
      const req = requiredPermissions(node);
      const selfAllowed = hasAnyPermission(set, req);

      if (node.children && node.children.length) {
        const visibleChildren = walk(node.children);
        // A group shows if it is itself allowed AND has at least one visible child.
        if (selfAllowed && visibleChildren.length > 0) {
          acc.push({ ...node, children: visibleChildren });
        }
      } else if (selfAllowed) {
        acc.push({ ...node });
      }
      return acc;
    }, []);

  return walk(menu);
}

/** The first navigable route at or under a node (its own `to`, else the first
 *  descendant leaf's route). Used to resolve a group's Alt+Shift shortcut target. */
function firstRoute(node: MenuNode): string | undefined {
  if (node.to) return node.to;
  for (const c of node.children ?? []) {
    const t = firstRoute(c);
    if (t) return t;
  }
  return undefined;
}

/**
 * The page to open a user on: the first route in THEIR filtered menu.
 *
 * Sending everyone to the dashboard means a user without `dashboard:view` signs
 * in to "Access denied" — a wall where their home page should be, even though
 * the sidebar beside it lists pages they can use. Landing them on the first
 * thing they CAN open makes the entry point follow the permissions, exactly as
 * the sidebar already does.
 *
 * The order is the MENU order, so this stays predictable: whatever sits at the
 * top of a user's sidebar is where they land. `undefined` means the account has
 * no accessible page at all — a permission set worth surfacing rather than
 * silently redirecting somewhere.
 */
export function landingRoute(granted: Iterable<string>, menu: MenuNode[] = MENU): string | undefined {
  for (const node of filterMenu(granted, menu)) {
    const to = firstRoute(node);
    if (to) return to;
  }
  return undefined;
}

/** The Alt+Shift+<letter> quick-nav targets for a (usually already permission-
 *  filtered) menu: every node — at ANY depth — that declares a `shortcut`, mapped
 *  to the page it opens. Shortcuts live on the sub-menu (leaf) items, so the key
 *  jumps straight to that page. Pass a filtered menu so a shortcut never targets a
 *  page the user can't see. */
export function menuShortcuts(menu: MenuNode[] = MENU): { key: string; to: string; label: string }[] {
  const out: { key: string; to: string; label: string }[] = [];
  const walk = (nodes: MenuNode[]) => {
    for (const node of nodes) {
      if (node.shortcut) {
        const to = firstRoute(node);
        if (to) out.push({ key: node.shortcut.toUpperCase(), to, label: node.label });
      }
      if (node.children) walk(node.children);
    }
  };
  walk(menu);
  return out;
}

/** Flatten the menu to its leaf routes (handy for building the router / breadcrumbs). */
export function menuRoutes(menu: MenuNode[] = MENU): { to: string; permission?: string; label: string; icon?: string }[] {
  const out: { to: string; permission?: string; label: string; icon?: string }[] = [];
  const walk = (nodes: MenuNode[]) => {
    for (const n of nodes) {
      if (n.to) out.push({ to: n.to, permission: n.permission, label: n.label, icon: n.icon });
      if (n.children) walk(n.children);
    }
  };
  walk(menu);
  return out;
}
