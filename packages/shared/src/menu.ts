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
}

// Built fresh — we add nodes here one screen at a time as each page is built.
export const MENU: MenuNode[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    to: '/',
    permission: perm(RESOURCES.DASHBOARD, ACTIONS.VIEW),
  },
  {
    id: 'customers-group',
    label: 'Customers',
    icon: 'Users',
    children: [
      {
        id: 'customers',
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
        id: 'agents',
        label: 'Agents',
        to: '/agents',
        icon: 'UserCog',
        permission: perm(RESOURCES.AGENT, ACTIONS.VIEW),
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
    ],
  },
  {
    id: 'products-group',
    label: 'Products',
    icon: 'Package',
    children: [
      {
        id: 'products',
        label: 'Products',
        to: '/products',
        icon: 'Box',
        permission: perm(RESOURCES.PRODUCT, ACTIONS.VIEW),
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
    ],
  },
  {
    id: 'orders-group',
    label: 'Orders',
    icon: 'ShoppingCart',
    anyPermission: [perm(RESOURCES.ORDER, ACTIONS.VIEW), perm(RESOURCES.ORDER, ACTIONS.CREATE)],
    children: [
      {
        id: 'new-order',
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
        id: 'order-modify',
        label: 'Order Modify',
        to: '/orders/modify',
        icon: 'ClipboardList',
        permission: perm(RESOURCES.ORDER, ACTIONS.UPDATE),
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    to: '/settings',
    icon: 'Settings',
    permission: perm(RESOURCES.SETTING, ACTIONS.VIEW),
  },
];

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

/** Flatten the menu to its leaf routes (handy for building the router / breadcrumbs). */
export function menuRoutes(menu: MenuNode[] = MENU): { to: string; permission?: string; label: string }[] {
  const out: { to: string; permission?: string; label: string }[] = [];
  const walk = (nodes: MenuNode[]) => {
    for (const n of nodes) {
      if (n.to) out.push({ to: n.to, permission: n.permission, label: n.label });
      if (n.children) walk(n.children);
    }
  };
  walk(menu);
  return out;
}
