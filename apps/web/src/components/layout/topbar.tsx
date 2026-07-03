import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, PanelLeft, UserRound } from 'lucide-react';
import { menuRoutes } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useLogout } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { useNudgeCount } from '@/features/crm/followup-nudge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Topbar bell: live count of commitments needing attention → opens Follow-ups. */
function CrmBell() {
  const navigate = useNavigate();
  const count = useNudgeCount();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" onClick={() => navigate('/crm')} aria-label={`Follow-ups${count ? ` — ${count} need attention` : ''}`}>
          <Bell className={count ? 'text-amber-600' : ''} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{count ? `${count} follow-up${count > 1 ? 's' : ''} need attention` : 'Follow-ups — all clear'}</TooltipContent>
    </Tooltip>
  );
}

function initials(name: string): string {
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
  const { can } = usePermissions();

  const title = useMemo(() => {
    const routes = menuRoutes();
    const match = routes
      .filter((r) => location.pathname === r.to || location.pathname.startsWith(`${r.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return match?.label ?? '';
  }, [location.pathname]);

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-3 shadow-sm shadow-blue-950/[0.03] backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onToggleMobile} aria-label="Open menu">
        <Menu />
      </Button>
      {/* Pin/unpin is only meaningful on large desktops — smaller screens always
          use the hover expand/collapse rail, so the button is hidden there. */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden min-[1600px]:inline-flex"
        onClick={onToggleCollapse}
        aria-label="Toggle sidebar"
      >
        <PanelLeft />
      </Button>

      <h1 className="truncate text-base font-bold tracking-tight">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        {can('crm:view') && <CrmBell />}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <Avatar>
                  <AvatarFallback className="bg-gradient-brand text-xs font-semibold text-white">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
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
              <DropdownMenuItem onClick={() => navigate('/admin/settings')}>
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
      </div>
    </header>
  );
}
