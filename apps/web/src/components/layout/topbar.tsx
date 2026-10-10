import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Monitor, Moon, RefreshCw, Sun, UserRound } from 'lucide-react';
import { useTheme, type ThemePref } from '@/lib/theme';
import { menuRoutes } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useLogout } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';
import { getMenuIcon } from '@/lib/icons';
import { NotificationsBell } from '@/features/crm/notifications-bell';
import { SystemStatus } from '@/components/common/system-status';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AppSwitcher } from './app-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** One-tap shortcuts to the screens used all day, in the order of the work:
 *  order → dispatch → bill → collect. Route, icon and permission come from the
 *  menu, so a shortcut only shows to someone who could open it anyway. */
const SHORTCUTS: { to: string; label: string; tone: string }[] = [
  { to: '/orders/new', label: 'New Order', tone: 'from-blue-500 to-indigo-600 shadow-indigo-500/30' },
  { to: '/challans/pending', label: 'Add Sales', tone: 'from-emerald-500 to-teal-600 shadow-emerald-500/30' },
  { to: '/dispatch/new', label: 'Dispatch', tone: 'from-orange-400 to-amber-600 shadow-amber-500/30' },
  { to: '/dispatch', label: 'Modify Dispatch', tone: 'from-violet-500 to-purple-600 shadow-purple-500/30' },
  { to: '/account/payment', label: 'Receive Payment', tone: 'from-rose-500 to-pink-600 shadow-rose-500/30' },
];

function Shortcuts() {
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const routes = useMemo(() => menuRoutes(), []);
  const items = SHORTCUTS.map((sc) => ({ ...sc, route: routes.find((r) => r.to === sc.to) })).filter(
    (sc) => sc.route && (!sc.route.permission || can(sc.route.permission)),
  );
  if (!items.length) return null;
  return (
    <nav aria-label="Shortcuts" className="mr-1 hidden min-w-0 items-center gap-1.5 md:flex">
      {items.map((sc) => {
        const Icon = getMenuIcon(sc.route!.icon);
        const active = pathname === sc.to;
        return (
          <Link
            key={sc.to}
            to={sc.to}
            title={sc.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b px-2.5 text-[13px] font-semibold whitespace-nowrap text-white shadow-md',
              'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110 active:translate-y-0 active:scale-[0.97]',
              'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              sc.tone,
              // The page you are on: ringed, so it reads as "here".
              active && 'outline-foreground/50 outline outline-2 outline-offset-2',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {/* Icons only until there is room for the words. */}
            <span className="hidden xl:inline">{sc.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Topbar({
  onToggleMobile,
  onToggleCollapse,
}: {
  onToggleMobile: () => void;
  onToggleCollapse: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  const match = useMemo(() => {
    const routes = menuRoutes();
    return routes
      .filter((r) => location.pathname === r.to || location.pathname.startsWith(`${r.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0];
  }, [location.pathname]);
  const title = match?.label ?? '';
  const PageIcon = getMenuIcon(match?.icon);

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-3 shadow-sm shadow-blue-950/[0.03] backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onToggleMobile} aria-label="Open menu">
        <Menu />
      </Button>
      {/* The current page's gradient icon badge, always shown so every page has an
          icon beside its title. On large desktops it doubles as the sidebar
          pin/unpin toggle; below 1600px pinning is ignored, so the click is a
          harmless no-op there (the rail stays hover-expand). */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label="Toggle sidebar"
        className="bg-gradient-brand ring-white/20 inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md ring-1 transition-opacity hover:opacity-90"
      >
        <PageIcon className="size-5" />
      </button>

      <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <Shortcuts />
        {/* Manual refresh — reloads the page so the latest data (and, with the
            network-first service worker, the latest deployed app version) is
            fetched. The companion to the auto-update-on-reload behaviour. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.location.reload()}
          aria-label="Refresh"
          title="Refresh — reload the latest data & app version"
        >
          <RefreshCw />
        </Button>
        <ThemeToggle />
        <SystemStatus variant="compact" />
        {/* ONE bell. It decides for itself what to show: CRM follow-ups for users
            with `crm:view`, and — for everyone — the offer to enrol this device
            for push, which is not a privileged action and must stay reachable
            without CRM access. Renders nothing when it has nothing to say. */}
        <NotificationsBell />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Just the avatar icon — the name shows inside the menu, not inline. */}
              <Button variant="ghost" size="icon" className="rounded-full" aria-label={user.name}>
                <Avatar>
                  <AvatarFallback className="bg-gradient-brand text-xs font-semibold text-white">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs font-normal">
                    {user.email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Roles: {user.roles.join(', ') || '—'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <UserRound />
                Account & settings
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <AppSwitcher />
      </div>
    </header>
  );
}

/** Cycles Light → Dark → System, showing the icon of the *current* choice. The
 *  three-way cycle keeps "follow the OS" reachable without a dropdown. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const order: ThemePref[] = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(theme) + 1) % order.length];
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const labels: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' };
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${labels[theme]}. Switch to ${labels[next]}.`}
      title={`Theme: ${labels[theme]} — click for ${labels[next]}`}
    >
      <Icon />
    </Button>
  );
}
