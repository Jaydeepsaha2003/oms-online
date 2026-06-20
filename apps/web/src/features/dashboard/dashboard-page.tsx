import { Boxes, ClipboardList, Factory, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATS = [
  { label: 'Open Orders', value: '—', icon: ClipboardList },
  { label: 'In Production', value: '—', icon: Factory },
  { label: 'Low Stock Items', value: '—', icon: Boxes },
  { label: 'Active Users', value: '—', icon: Users },
];

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome back{user ? `, ${user.name.split(' ')[0]}` : ''}
        </h2>
        <p className="text-muted-foreground text-sm">
          This is the OMS dashboard. Connect these cards to live data as you build out the modules.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {stat.label}
              </CardTitle>
              <stat.icon className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Getting started</CardTitle>
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
