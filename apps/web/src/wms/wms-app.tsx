import { lazy, Suspense, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Bug, LayoutDashboard, LogOut, Menu, Settings, Warehouse, type LucideIcon } from 'lucide-react';
import { useBootstrapAuth, useLogout } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { FullScreenLoader } from '@/components/common/full-screen-loader';
import { AppSwitcher } from '@/components/layout/app-switcher';
import { initials, ThemeToggle } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCompany } from '@/features/settings/use-settings';
import kavishLogo from '@/assets/kavish-logo.png';

const LoginPage = lazy(() => import('@/features/auth/login-page').then((m) => ({ default: m.LoginPage })));
const TasksPage = lazy(() => import('@/features/tasks/tasks-page').then((m) => ({ default: m.TasksPage })));

/** WMS menu — add a line per screen as the warehouse side is built. */
const MENU: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks & Bugs', icon: Bug },
];
/** What a WMS task can be about: its screens, and anything else. */
const TASK_AREAS = [...MENU.map((m) => m.label).filter((l) => l !== 'Tasks & Bugs'), 'Other'];

/** Warehouse Management: its own shell and pages, served at /wms/ by the same
 *  build as OMS, so the sign-in, API and database are shared. */
export function WmsApp() {
  useBootstrapAuth();
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<WmsShell />}>
            <Route path="/" element={<BlankPage />} />
            <Route path="/tasks/:id?" element={<TasksPage app="WMS" areas={TASK_AREAS} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

function WmsShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const page = MENU.find((m) => (m.to === '/' ? pathname === '/' : pathname.startsWith(m.to))) ?? MENU[0];
  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r md:block">
        <WmsSidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute top-0 left-0 h-full w-64 border-r shadow-lg">
            <WmsSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-3 shadow-sm backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <span className="bg-gradient-brand inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <page.icon className="size-5" />
          </span>
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{page.label}</h1>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
            <AppSwitcher />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3 sm:p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function WmsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: company } = useCompany();
  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-0.5 shadow-sm ring-1 ring-white/20">
          <img src={company?.logo || kavishLogo} alt="" className="size-full object-contain" />
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-base font-bold tracking-tight">WMS</span>
          <span className="text-sidebar-foreground/70 truncate text-xs font-medium">Warehouse Management</span>
        </div>
      </div>
      <nav className="border-sidebar-border flex flex-1 flex-col gap-0.5 border-t px-2 py-3">
        {MENU.map((m) => (
          <NavLink
            key={m.to}
            to={m.to}
            end={m.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[16.2px] font-medium text-white transition-all',
                'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                isActive &&
                  'bg-sidebar-accent text-sidebar-accent-foreground before:bg-brand-amber font-semibold shadow-sm before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full',
              )
            }
          >
            <m.icon className="group-hover:text-brand-amber size-4 shrink-0 transition-colors" />
            <span className="truncate">{m.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={user.name}>
          <Avatar>
            <AvatarFallback className="bg-gradient-brand text-xs font-semibold text-white">{initials(user.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate font-medium">{user.name}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.location.assign('/oms/settings')}>
          <Settings />
          Account & settings
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => logout.mutate(undefined, { onSettled: () => window.location.assign('/wms/login') })}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlankPage() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center">
      <Warehouse className="size-10 opacity-40" />
      <p className="text-sm">Warehouse Management is being set up.</p>
    </div>
  );
}
