import { ArrowUpRight, Boxes, ClipboardList, Factory, Sparkles, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Accent = 'blue' | 'amber' | 'orange' | 'sky';

const ACCENTS: Record<Accent, { tile: string; ring: string; text: string }> = {
  blue: {
    tile: 'bg-gradient-to-br from-blue-500 to-blue-700',
    ring: 'group-hover:ring-blue-500/30',
    text: 'text-blue-600',
  },
  amber: {
    tile: 'bg-gradient-to-br from-amber-400 to-amber-600',
    ring: 'group-hover:ring-amber-500/30',
    text: 'text-amber-600',
  },
  orange: {
    tile: 'bg-gradient-to-br from-orange-400 to-orange-600',
    ring: 'group-hover:ring-orange-500/30',
    text: 'text-orange-600',
  },
  sky: {
    tile: 'bg-gradient-to-br from-sky-400 to-sky-600',
    ring: 'group-hover:ring-sky-500/30',
    text: 'text-sky-600',
  },
};

const STATS: { label: string; value: string; delta: string; icon: typeof ClipboardList; accent: Accent }[] = [
  { label: 'Open Orders', value: '—', delta: 'Live soon', icon: ClipboardList, accent: 'blue' },
  { label: 'In Production', value: '—', delta: 'Live soon', icon: Factory, accent: 'amber' },
  { label: 'Low Stock Items', value: '—', delta: 'Live soon', icon: Boxes, accent: 'orange' },
  { label: 'Active Users', value: '—', delta: 'Live soon', icon: Users, accent: 'sky' },
];

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-16 size-64 rounded-full bg-amber-400/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 right-1/3 size-56 rounded-full bg-orange-500/20 blur-3xl"
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-white/25 backdrop-blur">
            <Sparkles className="size-3.5 text-amber-300" />
            OMS Workspace
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome back{user ? `, ${user.name.split(' ')[0]}` : ''}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-blue-100/90">
            Your production &amp; order management hub. Connect these cards to live data as you build
            out the modules.
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => {
          const a = ACCENTS[stat.accent];
          return (
            <Card
              key={stat.label}
              className={cn('card-hover group gap-0 ring-1 ring-transparent', a.ring)}
            >
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  {stat.label}
                </CardTitle>
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl text-white shadow-sm',
                    a.tile,
                  )}
                >
                  <stat.icon className="size-4.5" />
                </span>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight tabular-nums">{stat.value}</div>
                <div className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium', a.text)}>
                  <ArrowUpRight className="size-3.5" />
                  {stat.delta}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Getting started */}
      <Card className="card-hover">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="bg-gradient-brand flex size-7 items-center justify-center rounded-lg text-white shadow-sm">
              <Sparkles className="size-4" />
            </span>
            Getting started
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>The architecture is ready. Each menu item routes to a scaffold page for now.</p>
          <p>
            Build a screen, add its permissions to <code>@oms/shared</code>, register a node in the
            <code> MENU</code> registry, and it appears in the sidebar for the right roles.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
