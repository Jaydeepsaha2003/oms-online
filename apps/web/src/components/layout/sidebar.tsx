import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, Boxes } from 'lucide-react';
import { filterMenu, MENU, type MenuNode } from '@oms/shared';
import { cn } from '@/lib/utils';
import { getMenuIcon } from '@/lib/icons';
import { usePermissions } from '@/hooks/use-permissions';
import { useNudgeCount } from '@/features/crm/followup-nudge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'OMS';

interface SidebarProps {
  collapsed?: boolean;
  /** Called after navigating (used to close the mobile drawer). */
  onNavigate?: () => void;
}

/**
 * Dynamic navigation. The tree comes from the shared MENU registry and is
 * filtered to the current user's permissions — items they can't access never
 * render. Add a node to MENU (in @oms/shared) and it appears here automatically.
 */
export function Sidebar({ collapsed = false, onNavigate }: SidebarProps) {
  const { permissions, can } = usePermissions();
  const location = useLocation();
  const nudges = useNudgeCount(can('crm:view'));
  const items = useMemo(() => {
    const filtered = filterMenu(permissions, MENU);
    if (nudges > 0) {
      // Attach the live "needs attention" count to the CRM → Follow-ups item.
      for (const g of filtered) {
        const leaf = g.children?.find((c) => c.id === 'crm-followups');
        if (leaf) leaf.badge = String(nudges);
      }
    }
    return filtered;
  }, [permissions, nudges]);

  // Accordion: only one group is open at a time. Default to the active route's group.
  const activeGroupId = useMemo(
    () =>
      items.find(
        (n) => n.children?.length && n.children.some((c) => c.to && location.pathname.startsWith(c.to)),
      )?.id ?? null,
    [items, location.pathname],
  );
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupId);

  // Opening a group via navigation keeps that group open (but manual collapses stick).
  useEffect(() => {
    if (activeGroupId) setOpenGroup(activeGroupId);
  }, [activeGroupId]);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-16 items-center gap-3 px-4', collapsed && 'justify-center px-0')}>
        <div className="bg-gradient-brand flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-lg shadow-blue-950/40 ring-1 ring-white/20">
          <Boxes className="size-5" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-base font-bold tracking-tight">{APP_NAME}</span>
            <span className="truncate text-[11px] font-medium text-sidebar-foreground/55">
              Order Management
            </span>
          </div>
        )}
      </div>
      <Separator className="bg-sidebar-border" />

      <ScrollArea className="flex-1 px-2 py-3">
        <nav className={cn('flex flex-col', collapsed ? 'gap-0' : 'gap-0.5')}>
          {items.map((node) =>
            node.children?.length ? (
              <MenuGroup
                key={node.id}
                node={node}
                collapsed={collapsed}
                onNavigate={onNavigate}
                open={openGroup === node.id}
                onToggle={() => setOpenGroup((prev) => (prev === node.id ? null : node.id))}
              />
            ) : (
              <MenuLeaf key={node.id} node={node} collapsed={collapsed} onNavigate={onNavigate} />
            ),
          )}
        </nav>
      </ScrollArea>

      {!collapsed && (
        <div className="px-4 py-3 text-xs text-sidebar-foreground/45">
          <Separator className="mb-3 bg-sidebar-border" />
          {APP_NAME} · v0.1.0
        </div>
      )}
    </div>
  );
}

function MenuLeaf({
  node,
  collapsed,
  onNavigate,
}: {
  node: MenuNode;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = getMenuIcon(node.icon);
  const link = (
    <NavLink
      to={node.to!}
      end={node.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-all',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          isActive &&
            'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-brand-amber',
          collapsed && 'justify-center px-0 py-1.5',
        )
      }
    >
      <Icon className="size-4 shrink-0 transition-colors group-hover:text-brand-amber" />
      {!collapsed && <span className="truncate">{node.label}</span>}
      {!collapsed && node.badge && (
        <span className="ml-auto rounded bg-brand-amber/20 px-1.5 py-0.5 text-xs font-semibold text-brand-amber">
          {node.badge}
        </span>
      )}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{node.label}</TooltipContent>
    </Tooltip>
  );
}

function MenuGroup({
  node,
  collapsed,
  onNavigate,
  open,
  onToggle,
}: {
  node: MenuNode;
  collapsed: boolean;
  onNavigate?: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const location = useLocation();
  const childActive = (node.children ?? []).some(
    (c) => c.to && location.pathname.startsWith(c.to),
  );
  const Icon = getMenuIcon(node.icon);

  // Collapsed rail: render the group's children as icon links with tooltips.
  if (collapsed) {
    return (
      <div className="flex flex-col gap-0">
        {(node.children ?? []).map((child) => (
          <MenuLeaf key={child.id} node={child} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-all',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          childActive && 'text-sidebar-accent-foreground',
        )}
      >
        <Icon className="size-4 shrink-0 transition-colors group-hover:text-brand-amber" />
        <span className="truncate">{node.label}</span>
        <ChevronRight className={cn('ml-auto size-4 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l pl-2">
          {(node.children ?? []).map((child) => (
            <MenuLeaf key={child.id} node={child} collapsed={false} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}
